// One-time codes for unlocking a hard-locked customer account.
//
// Security posture (see .claude/rules/auth-security.md):
//  - Codes are generated with node:crypto (not Math.random).
//  - Only a SHA-256 hash is stored; the code is never persisted or returned.
//  - Verification is attempt-limited and single-use, compared in constant time.
//  - Sends are rate-limited per customer to prevent email/SMS bombing.
//  - The channel follows registration type: email (link-registered) or SMS
//    (agent-registered, no smartphone).
import { randomInt, createHash, timingSafeEqual } from 'crypto'
import { prisma } from './prisma'
import { sendMail } from './mail'
import { sendSMS } from './kudisms'

export const OTP_TTL_MS = 10 * 60_000
export const MAX_VERIFY_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60_000

type Channel = 'email' | 'sms'

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function pickChannel(customer: { email?: string | null; phone: string }): {
  channel: Channel
  target: string
} {
  if (customer.email) return { channel: 'email', target: customer.email }
  return { channel: 'sms', target: customer.phone }
}

export function maskTarget(channel: Channel, target: string): string {
  if (channel === 'email') {
    const [user, domain] = target.split('@')
    const head = user.slice(0, 1)
    return `${head}${'*'.repeat(Math.max(user.length - 1, 1))}@${domain}`
  }
  const last4 = target.slice(-4)
  return `${'*'.repeat(Math.max(target.length - 4, 0))}${last4}`
}

/** Store a hashed code for a customer (storage primitive; also used by tests). */
export async function createUnlockOtp(
  customerId: string,
  channel: Channel,
  code: string,
  now: number = Date.now(),
): Promise<void> {
  await prisma.accountUnlockOtp.create({
    data: {
      customerId,
      channel,
      codeHash: hashCode(code),
      expiresAt: new Date(now + OTP_TTL_MS),
    },
  })
}

async function deliver(
  channel: Channel,
  target: string,
  firstName: string,
  code: string,
): Promise<boolean> {
  if (channel === 'email') {
    try {
      await sendMail({
        to: target,
        subject: 'Your Vochus Easy Save account unlock code',
        html: `<p>Hi ${firstName},</p><p>Your account was locked after too many failed login attempts. Use this code to unlock it:</p><p><strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes. If this wasn't you, change your password after unlocking. Never share this code.</p>`,
      })
      return true
    } catch {
      return false
    }
  }
  const r = await sendSMS(
    target,
    `Vochus Easy Save: your account unlock code is ${code}. Valid for 10 minutes. Do not share it.`,
  )
  return r.success
}

export interface RequestResult {
  sent: boolean
  channel?: Channel
  maskedTarget?: string
  retryAfterSeconds?: number
}

/** Generate, store and send an unlock code for a locked account, rate-limiting
 *  resends. Never returns the code. */
export async function requestUnlockOtp(
  customer: { id: string; email?: string | null; phone: string; firstName: string },
  now: number = Date.now(),
): Promise<RequestResult> {
  const last = await prisma.accountUnlockOtp.findFirst({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
  })
  if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return {
      sent: false,
      retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - last.createdAt.getTime())) / 1000),
    }
  }

  const { channel, target } = pickChannel(customer)
  const code = generateCode()
  await createUnlockOtp(customer.id, channel, code, now)
  const ok = await deliver(channel, target, customer.firstName, code)
  return ok
    ? { sent: true, channel, maskedTarget: maskTarget(channel, target) }
    : { sent: false }
}

/** Verify a code: latest unconsumed, unexpired, under the attempt cap, matching
 *  the stored hash. Consumes it on success. Never reveals which check failed. */
export async function verifyUnlockOtp(
  customerId: string,
  code: string,
  now: number = Date.now(),
): Promise<{ ok: boolean }> {
  const otp = await prisma.accountUnlockOtp.findFirst({
    where: { customerId, consumedAt: null, expiresAt: { gt: new Date(now) } },
    orderBy: { createdAt: 'desc' },
  })
  if (!otp) return { ok: false }
  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false }

  if (!hashesEqual(otp.codeHash, hashCode(code))) {
    await prisma.accountUnlockOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false }
  }

  await prisma.accountUnlockOtp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date(now) },
  })
  return { ok: true }
}
