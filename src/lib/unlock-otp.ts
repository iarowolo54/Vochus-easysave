// One-time codes for unlocking a hard-locked customer account. They live in PasswordResetOtp under
// their own purpose, so they get the same keyed hash, resetId binding and limits as password resets.
//
// The channel is a verified email if there is one, otherwise SMS.
import { sendMail } from './mail'
import { sendSMS } from './kudisms'
import { deliverInBackground, issueResetCode } from './password-reset'

export { generateCode } from './password-reset'

type Channel = 'email' | 'sms'

export function pickChannel(customer: { email?: string | null; phone: string }): {
  channel: Channel
  target: string
} {
  if (customer.email) return { channel: 'email', target: customer.email }
  return { channel: 'sms', target: customer.phone }
}

/** Where a customer's recovery codes go. An unverified email may be whatever an agent typed, so it's never used. */
export function recoveryChannel(customer: { email?: string | null; emailVerifiedAt?: Date | null; phone: string }) {
  return pickChannel({ email: customer.emailVerifiedAt ? customer.email : null, phone: customer.phone })
}

/** Where an agent's unlock code goes: their email once they have confirmed it (SMS costs money), otherwise their phone. */
export function agentRecoveryChannel(agent: { email?: string | null; emailVerified?: boolean | null; phone: string }) {
  const email = agent.email?.trim()
  return email && agent.emailVerified ? { channel: 'email' as const, target: email } : { channel: 'sms' as const, target: agent.phone }
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

/** Issue and send an unlock code without waiting for delivery, so a locked account doesn't answer
 *  slower than any other. Null while the account is in its cooldown or over its daily cap. Older
 *  codes stay valid, so a stranger's request can't retire the owner's. */
export async function requestUnlockOtp(
  customer: { id: string; email?: string | null; emailVerifiedAt?: Date | null; phone: string; firstName: string },
  now: number = Date.now(),
  send: typeof deliver = deliver, // injectable for tests
  ip: string = 'unknown',
): Promise<{ resetId: string; delivered: Promise<void> } | null> {
  const issued = await issueResetCode('customer', customer.id, now, 'login_unlock', ip)
  if (!issued) return null
  const { channel, target } = recoveryChannel(customer)
  const delivered = deliverInBackground(issued.id, () => send(channel, target, customer.firstName, issued.code))
  return { resetId: issued.resetId, delivered }
}
