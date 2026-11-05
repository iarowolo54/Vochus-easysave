// The code that proves a customer agreed to save into a finished plan again. It goes by SMS to the phone on file
// (the verified email if the text can't be sent), for online and cash customers alike. For a cash customer the agent
// asks for it; for an online customer it confirms the person holding the phone is the one asking.
// It is stored in PasswordResetOtp (hashed, 5 tries, 10 minutes, one use) under a purpose that names the plan, so a
// code for one plan can't restart another, and using it retires no other kind of code.
import { sendMail } from './mail'
import { sendSMS } from './kudisms'
import { issueResetCode, redeemResetCode, cancelResetCode, type ResetPurpose } from './password-reset'
import { maskTarget } from './unlock-otp'

export const REOPEN_CODE_INVALID = 'That code didn’t work or has expired. Check it, or ask for a new one.'
export const REOPEN_CODE_WAIT = 'A code was just sent. Wait a minute before asking for another.'
export const REOPEN_CODE_NOT_SENT = 'We couldn’t send the code. Try again in a moment.'

const purposeFor = (planId: string): ResetPurpose => `plan_reopen:${planId}`

type Customer = { id: string; phone: string; firstName: string; email?: string | null; emailVerifiedAt?: Date | null }
type Sender = (c: Customer, code: string, byAgent: boolean) => Promise<boolean>

async function deliver(c: Customer, code: string, byAgent: boolean): Promise<boolean> {
  const text = byAgent
    ? `Vochus Easy Save: your code to save into your plan again is ${code}. Give it to your agent only if you asked to restart your plan. Valid 10 minutes.`
    : `Vochus Easy Save: your code to save into your plan again is ${code}. Valid 10 minutes. Do not share it.`
  const sms = await sendSMS(c.phone, text).catch(() => ({ success: false }))
  if (sms.success) return true
  if (!c.email || !c.emailVerifiedAt) return false
  try {
    await sendMail({
      to: c.email,
      subject: 'Your Vochus Easy Save code to save again',
      html: `<p>Hi ${c.firstName},</p><p>Your code to save into your plan again is:</p><p><strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes. ${byAgent ? 'Give it to your agent only if you asked to restart your plan.' : 'Do not share it.'}</p>`,
    })
    return true
  } catch {
    return false
  }
}

/** Sends a code for this plan. `reason` says why nothing was sent. */
export async function requestReopenCode(
  customer: Customer,
  planId: string,
  byAgent: boolean,
  send: Sender = deliver, // injectable for tests
  now: number = Date.now(),
): Promise<{ ok: true; resetId: string; sentTo: string } | { ok: false; reason: 'wait' | 'not_sent' }> {
  const issued = await issueResetCode('customer', customer.id, now, purposeFor(planId))
  if (!issued) return { ok: false, reason: 'wait' }
  const sent = await send(customer, issued.code, byAgent).catch(() => false)
  if (!sent) {
    await cancelResetCode(issued.id)
    return { ok: false, reason: 'not_sent' }
  }
  return { ok: true, resetId: issued.resetId, sentTo: maskTarget('sms', customer.phone) }
}

/** True once, for the right code on this plan. */
export async function confirmReopenCode(customerId: string, planId: string, resetId: string, code: string, now: number = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code) || !resetId) return false
  return (await redeemResetCode('customer', customerId, resetId, code, now, purposeFor(planId))) !== null
}
