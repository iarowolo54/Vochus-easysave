// The limit on super admin sign-in. Counts live in LoginAttempt, so they hold across PM2 instances.
//
// The lock has to balance two things. Someone who only knows the owner's email can trigger it, so it always ends on its
// own. But if it stayed short, guessing could carry on all day, so repeats get longer: 5 failures lock for 5 minutes, the
// next 5 for 15, then 60 from there on, about 120 guesses a day at most. A quiet day starts over. Tries during a lock aren't
// counted and don't extend it. Attempts are counted for unknown emails too, and the answers are the same, so neither the
// lock nor the timing says whether an account exists.
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { SuperAdmin } from '@prisma/client'
import { logAudit } from './audit'
import type { ReservedAttempt } from './login-attempt'
import { ADMIN_QUIET_MS, refundAttempt, reserveAttempt, sweepStaleLoginAttempts } from './login-attempt'
import { prisma } from './prisma'

export const ADMIN_ACCOUNT_FAIL_LIMIT = 5
export const ADMIN_IP_FAIL_LIMIT = 10
const MINUTE = 60_000
const ADMIN_ACCOUNT_LOCK_STEPS_MS = [5 * MINUTE, 15 * MINUTE, 60 * MINUTE]
const ADMIN_IP_LOCK_STEPS_MS = [15 * MINUTE, 60 * MINUTE]
const AUDIT_UNKNOWN_EMAIL_LENGTH = 12
const MAX_EMAIL_LENGTH = 254

export type AdminLoginResult = { kind: 'ok'; admin: SuperAdmin } | { kind: 'invalid' } | { kind: 'locked' }

// Compared against for an unknown email, so a miss takes as long as a wrong password.
const decoyHash = bcrypt.hash(randomBytes(32).toString('hex'), 10)

function lockedAudit(what: string): Promise<void> {
  return logAudit({ action: 'admin_login_locked', entity: 'SuperAdmin', details: `Admin sign-in locked: ${what}`, actorType: 'system', actorName: 'Admin login limit' })
}

export async function verifyAdminLogin(emailInput: string, password: string, ip: string | null): Promise<AdminLoginResult> {
  const email = emailInput.trim().toLowerCase()
  const accountKey = email.length <= MAX_EMAIL_LENGTH ? `admin:${email}` : null
  const ipKey = ip ? `ip:admin:${ip}` : null
  const now = Date.now()

  // This is the highest-privilege login, so an attempt that can't be counted doesn't get to try: unlike customer login,
  // it fails closed. The address goes first, so a blocked address never touches the account's count.
  let ipSlot: ReservedAttempt = { allowed: true, startedLock: false, firstLock: false }
  let accountSlot: ReservedAttempt = { allowed: true, startedLock: false, firstLock: false }
  try {
    if (ipKey) {
      ipSlot = await reserveAttempt(ipKey, ADMIN_IP_FAIL_LIMIT, ADMIN_IP_LOCK_STEPS_MS, ADMIN_QUIET_MS, now)
      if (!ipSlot.allowed) return { kind: 'locked' }
    }
    if (accountKey) {
      accountSlot = await reserveAttempt(accountKey, ADMIN_ACCOUNT_FAIL_LIMIT, ADMIN_ACCOUNT_LOCK_STEPS_MS, ADMIN_QUIET_MS, now)
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

  // Only the first lock after a quiet window: repeats would just be noise. An unknown "email" may be a pasted password.
  if (accountSlot.firstLock) {
    const who = admin ? email : `unknown email ${email.slice(0, AUDIT_UNKNOWN_EMAIL_LENGTH)}…`
    await lockedAudit(`${who} after ${ADMIN_ACCOUNT_FAIL_LIMIT} failures, for ${ADMIN_ACCOUNT_LOCK_STEPS_MS[0] / MINUTE} minutes, longer on repeats`)
  }
  if (ipSlot.firstLock) await lockedAudit(`address ${ip} after ${ADMIN_IP_FAIL_LIMIT} failures, for ${ADMIN_IP_LOCK_STEPS_MS[0] / MINUTE} minutes, longer on repeats`)
  if (Math.random() < 0.02) void sweepStaleLoginAttempts(now).catch(() => {})
  return { kind: 'invalid' }
}
