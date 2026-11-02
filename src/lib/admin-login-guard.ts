// The limit on super admin sign-in, shared by both paths in (the login route and the NextAuth provider) so failures on
// one count on the other. Counts live in LoginAttempt, so they hold across PM2 instances.
//
// The lock is deliberately short: someone who only knows the owner's email can trigger it, and it mustn't keep the owner
// out for long. Tries during a lock aren't counted and don't extend it. Failures are counted for unknown emails too, and
// the answers are the same, so neither the lock nor the timing says whether an account exists.
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { SuperAdmin } from '@prisma/client'
import { logAudit } from './audit'
import { bumpTimedLock, isTimeLocked, sweepStaleLoginAttempts } from './login-attempt'
import { prisma } from './prisma'

export const ADMIN_ACCOUNT_FAIL_LIMIT = 5
export const ADMIN_IP_FAIL_LIMIT = 10
const ADMIN_ACCOUNT_LOCK_MS = 5 * 60_000
const ADMIN_IP_LOCK_MS = 15 * 60_000
const MAX_EMAIL_LENGTH = 254

export type AdminLoginResult = { kind: 'ok'; admin: SuperAdmin } | { kind: 'invalid' } | { kind: 'locked' }

// Compared against for an unknown email, so a miss takes as long as a wrong password.
const decoyHash = bcrypt.hash(randomBytes(32).toString('hex'), 10)

function lockedAudit(what: string): Promise<void> {
  return logAudit({ action: 'admin_login_locked', entity: 'SuperAdmin', details: `Admin sign-in locked: ${what}`, actorType: 'system', actorName: 'Admin login limit' })
}

/** The rightmost X-Forwarded-For entry is the one our proxy appended; the rest are client-supplied. */
export function adminIpFromForwarded(xff: string | string[] | null | undefined): string | null {
  const header = Array.isArray(xff) ? xff.join(',') : xff
  const ip = header?.split(',').map(s => s.trim()).filter(Boolean).pop()
  return ip && ip.length <= 45 ? ip : null
}

export async function verifyAdminLogin(emailInput: string, password: string, ip: string | null): Promise<AdminLoginResult> {
  const email = emailInput.trim().toLowerCase()
  const accountKey = email.length <= MAX_EMAIL_LENGTH ? `admin:${email}` : null
  const ipKey = ip ? `ip:admin:${ip}` : null
  const now = Date.now()

  // The limit must never take down sign-in itself: if the database is truly gone, the lookup below fails too.
  const locked = await Promise.all([accountKey, ipKey].map(k => (k ? isTimeLocked(k, now) : false))).catch(() => [false])
  if (locked.some(Boolean)) return { kind: 'locked' }

  const admin = accountKey ? await prisma.superAdmin.findUnique({ where: { email } }) : null
  const valid = await bcrypt.compare(password, admin?.password ?? await decoyHash)
  if (admin && valid) {
    if (accountKey) await prisma.loginAttempt.deleteMany({ where: { key: accountKey } }).catch(() => {})
    return { kind: 'ok', admin }
  }

  try {
    if (accountKey && await bumpTimedLock(accountKey, n => (n >= ADMIN_ACCOUNT_FAIL_LIMIT ? ADMIN_ACCOUNT_LOCK_MS : 0), now)) {
      await lockedAudit(`${email} after ${ADMIN_ACCOUNT_FAIL_LIMIT} failures, for ${ADMIN_ACCOUNT_LOCK_MS / 60_000} minutes`)
    }
    if (ipKey && await bumpTimedLock(ipKey, n => (n >= ADMIN_IP_FAIL_LIMIT ? ADMIN_IP_LOCK_MS : 0), now)) {
      await lockedAudit(`address ${ip} after ${ADMIN_IP_FAIL_LIMIT} failures, for ${ADMIN_IP_LOCK_MS / 60_000} minutes`)
    }
    if (Math.random() < 0.02) void sweepStaleLoginAttempts(now).catch(() => {})
  } catch (e) {
    console.error('[admin-login] recording a failure failed:', e instanceof Error ? e.message : 'unknown')
  }
  return { kind: 'invalid' }
}
