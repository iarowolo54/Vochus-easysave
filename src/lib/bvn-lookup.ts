// A BVN lookup returns someone's legal name and is charged to Vochus's Paystack account, so it has to
// be earned. The enrol page confirms the email before it asks for a BVN, so that is what's required,
// with caps kept in the database because production runs two instances.
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/email'

export const BVN_LOOKUPS_PER_EMAIL = 10
export const BVN_LOOKUPS_PER_IP_PER_HOUR = 30

// Same window as the verified-email gate in customer/enroll.
const VERIFIED_EMAIL_WINDOW_MS = 30 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
// EmailOTP.attempts counts wrong codes up to 5 before it's verified (email-otp/verify). Lookups continue
// the same counter, so whatever the customer used on the code, they still get the full number.
const OTP_ATTEMPTS = 5

/**
 * Spends one lookup for this IP. Returns false when the hour's budget has gone. Uses LoginAttempt rows
 * under their own key prefix. The window end is kept in lockedUntil, which also stops the login sweep
 * deleting a live window, and lets it clean the row up afterwards.
 */
export async function spendIpLookup(ip: string, now = new Date()): Promise<boolean> {
  const key = `bvn-lookup:ip:${ip}`
  const windowEnd = new Date(now.getTime() + HOUR_MS)
  // Losing a create race is fine, the row exists. Any other failure shows up as no row below: refused.
  await prisma.loginAttempt.upsert({ where: { key }, create: { key, failCount: 0, lockedUntil: windowEnd }, update: {} }).catch(() => {})
  await prisma.loginAttempt.updateMany({ where: { key, lockedUntil: { lt: now } }, data: { failCount: 0, lockedUntil: windowEnd } })
  const spent = await prisma.loginAttempt.updateMany({
    where: { key, failCount: { lt: BVN_LOOKUPS_PER_IP_PER_HOUR } },
    data: { failCount: { increment: 1 } },
  })
  return spent.count === 1
}

export type BvnLookupRefusal = { status: 403 | 429; error: string }

/** Null when this lookup may go ahead (and has been counted), otherwise why not. */
export async function refuseBvnLookup(rawEmail: unknown, ip: string, now = new Date()): Promise<BvnLookupRefusal | null> {
  const otp = typeof rawEmail === 'string' && rawEmail
    ? await prisma.emailOTP.findFirst({
        where: { email: normalizeEmail(rawEmail), verified: true, createdAt: { gte: new Date(now.getTime() - VERIFIED_EMAIL_WINDOW_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null
  if (!otp) return { status: 403, error: 'Confirm your email first' }

  const tooMany = { status: 429, error: 'Too many BVN checks. Try again later, or carry on without a BVN.' } as const
  const counted = await prisma.emailOTP.updateMany({
    where: { id: otp.id, verified: true, attempts: { lt: OTP_ATTEMPTS + BVN_LOOKUPS_PER_EMAIL } },
    data: { attempts: { increment: 1 } },
  })
  if (counted.count === 0) return tooMany
  return (await spendIpLookup(ip, now)) ? null : tooMany
}
