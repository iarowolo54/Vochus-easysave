// A BVN lookup reads someone's legal name and is charged to Vochus's Paystack account, so it has to
// be earned, and callers only ever learn whether a typed name matches, never the name itself. The enrol page confirms the email before it asks for a BVN, so that is what's required,
// with caps kept in the database because production runs two instances.
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/email'

export const BVN_LOOKUPS_PER_EMAIL_PER_HOUR = 10
export const BVN_LOOKUPS_PER_IP_PER_HOUR = 30

// Same window as the verified-email gate in customer/enroll.
const VERIFIED_EMAIL_WINDOW_MS = 30 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/**
 * Spends one lookup from an hourly budget. Returns false when it has gone. Uses LoginAttempt rows under
 * their own key prefix, so it holds across instances and survives a new email code. The window end is
 * kept in lockedUntil, which also stops the login sweep deleting a live window, and lets it clean the
 * row up afterwards.
 */
async function spendHourlyBudget(key: string, limit: number, now: Date): Promise<boolean> {
  const windowEnd = new Date(now.getTime() + HOUR_MS)
  // Losing a create race is fine, the row exists. Any other failure shows up as no row below: refused.
  await prisma.loginAttempt.upsert({ where: { key }, create: { key, failCount: 0, lockedUntil: windowEnd }, update: {} }).catch(() => {})
  await prisma.loginAttempt.updateMany({ where: { key, lockedUntil: { lt: now } }, data: { failCount: 0, lockedUntil: windowEnd } })
  const spent = await prisma.loginAttempt.updateMany({ where: { key, failCount: { lt: limit } }, data: { failCount: { increment: 1 } } })
  return spent.count === 1
}

export const spendIpLookup = (ip: string, now = new Date()) => spendHourlyBudget(`bvn-lookup:ip:${ip}`, BVN_LOOKUPS_PER_IP_PER_HOUR, now)
export const spendEmailLookup = (email: string, now = new Date()) => spendHourlyBudget(`bvn-lookup:email:${email}`, BVN_LOOKUPS_PER_EMAIL_PER_HOUR, now)

/** The one name comparison for enrolment: ignores case and spaces around each name, nothing else. */
export function bvnNameMatches(resolved: { firstName?: string | null; lastName?: string | null }, typed: { firstName: string; lastName: string }): boolean {
  const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
  return same(resolved.firstName, typed.firstName) && same(resolved.lastName, typed.lastName)
}

export type BvnLookupRefusal = { status: 403 | 429; error: string }

/** Null when this lookup may go ahead (and has been counted), otherwise why not. */
export async function refuseBvnLookup(rawEmail: unknown, ip: string, now = new Date()): Promise<BvnLookupRefusal | null> {
  const email = typeof rawEmail === 'string' && rawEmail ? normalizeEmail(rawEmail) : null
  const otp = email
    ? await prisma.emailOTP.findFirst({
        where: { email, verified: true, createdAt: { gte: new Date(now.getTime() - VERIFIED_EMAIL_WINDOW_MS) } },
        select: { id: true },
      })
    : null
  if (!email || !otp) return { status: 403, error: 'Confirm your email first' }

  if ((await spendEmailLookup(email, now)) && (await spendIpLookup(ip, now))) return null
  return { status: 429, error: 'Too many BVN checks. Try again later, or carry on without a BVN.' }
}
