// The limit on super admin sign-in, shared by both paths in (the login route and the NextAuth provider) so failures on
// one count on the other. Counts live in LoginAttempt, so they hold across PM2 instances.
//
// The lock is deliberately short: someone who only knows the owner's email can trigger it, and it mustn't keep the owner
// out for long. Tries during a lock aren't counted and don't extend it, and the count restarts when a lock ends. Attempts
// are counted for unknown emails too, and the answers are the same, so neither the lock nor the timing says whether an
// account exists.
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import bcrypt from 'bcryptjs'
import type { SuperAdmin } from '@prisma/client'
import { logAudit } from './audit'
import { refundAttempt, reserveAttempt, sweepStaleLoginAttempts } from './login-attempt'
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
  return ip && isIP(ip) ? ip : null
}

export async function verifyAdminLogin(emailInput: string, password: string, ip: string | null): Promise<AdminLoginResult> {
  const email = emailInput.trim().toLowerCase()
  const accountKey = email.length <= MAX_EMAIL_LENGTH ? `admin:${email}` : null
  const ipKey = ip ? `ip:admin:${ip}` : null
  const now = Date.now()

  // This is the highest-privilege login, so an attempt that can't be counted doesn't get to try: unlike customer login,
  // it fails closed. The address goes first, so a blocked address never touches the account's count.
  let ipSlot = { allowed: true, startedLock: false }
  let accountSlot = { allowed: true, startedLock: false }
  try {
    if (ipKey) {
      ipSlot = await reserveAttempt(ipKey, ADMIN_IP_FAIL_LIMIT, ADMIN_IP_LOCK_MS, now)
      if (!ipSlot.allowed) return { kind: 'locked' }
    }
    if (accountKey) {
      accountSlot = await reserveAttempt(accountKey, ADMIN_ACCOUNT_FAIL_LIMIT, ADMIN_ACCOUNT_LOCK_MS, now)
      if (!accountSlot.allowed) {
        if (ipKey) await refundAttempt(ipKey, ipSlot.startedLock)
        return { kind: 'locked' }
      }
    }
  } catch (e) {
    console.error('[admin-login] could not count the attempt, refusing:', e instanceof Error ? e.message : 'unknown')
    return { kind: 'locked' }
  }

  const admin = accountKey ? await prisma.superAdmin.findUnique({ where: { email } }) : null
  const valid = await bcrypt.compare(password, admin?.password ?? await decoyHash)
  if (admin && valid) {
    if (accountKey) await prisma.loginAttempt.deleteMany({ where: { key: accountKey } }).catch(() => {})
    if (ipKey) await refundAttempt(ipKey, ipSlot.startedLock).catch(() => {})
    return { kind: 'ok', admin }
  }

  if (accountSlot.startedLock) await lockedAudit(`${email} after ${ADMIN_ACCOUNT_FAIL_LIMIT} failures, for ${ADMIN_ACCOUNT_LOCK_MS / 60_000} minutes`)
  if (ipSlot.startedLock) await lockedAudit(`address ${ip} after ${ADMIN_IP_FAIL_LIMIT} failures, for ${ADMIN_IP_LOCK_MS / 60_000} minutes`)
  if (Math.random() < 0.02) void sweepStaleLoginAttempts(now).catch(() => {})
  return { kind: 'invalid' }
}
