// A BVN lookup reads someone's legal name and is charged to Vochus's Paystack account, so it has to
// be earned, and callers only ever learn whether a typed name matches, never the name itself. The enrol page confirms the email before it asks for a BVN, so that is what's required,
// with caps kept in the database because production runs two instances.
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/email'
import { BvnLookupFailed } from '@/lib/paystack'

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

/** The one name comparison for enrolment: ignores case and extra spaces, and treats a phone keyboard's ’ as '. */
export function bvnNameMatches(resolved: { firstName?: string | null; lastName?: string | null }, typed: { firstName: string; lastName: string }): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/’/g, "'").trim().toLowerCase()
  return norm(resolved.firstName) === norm(typed.firstName) && norm(resolved.lastName) === norm(typed.lastName)
}

/** So a wrong Paystack key gets noticed. Error class and status only: the reply can name someone. */
export function logBvnFailure(e: unknown): void {
  console.error('[bvn] check failed', e instanceof Error ? e.name : 'unknown', e instanceof BvnLookupFailed ? e.httpStatus : '-')
}

export type BvnLookupRefusal = { status: 403 | 429; error: string; code?: 'bvn_budget' }

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

  // IP first: a request already refused for its IP shouldn't use up this email's checks.
  if ((await spendIpLookup(ip, now)) && (await spendEmailLookup(email, now))) return null
  return { status: 429, code: 'bvn_budget', error: 'Too many BVN checks right now. Remove the BVN to carry on without it.' }
}
