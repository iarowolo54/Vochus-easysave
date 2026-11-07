// The code that proves a customer agreed to roll over a matured plan, or to save into a collected plan again.
// Online customers (a plan they opened themselves) get it by email first when their email is confirmed, with SMS as
// the backup. Cash customers (a plan their agent opened) always get it by SMS — they are with their agent, who asks
// for it — with a confirmed email only if the text can't be sent.
// It is stored in PasswordResetOtp (hashed, 5 tries, 10 minutes, one use) under a purpose that names the plan, so a
// code for one plan can't restart another, and using it retires no other kind of code.
import { sendMail } from './mail'
import { sendSMS } from './kudisms'
import { issueResetCode, redeemResetCode, cancelResetCode, type ResetPurpose } from './password-reset'
import { maskTarget } from './unlock-otp'
import { escapeHtml } from './escape-html'
import { prisma } from './prisma'

export const REOPEN_CODE_INVALID = 'That code didn’t work or has expired. Check it, or ask for a new one.'
export const REOPEN_CODE_WAIT = 'A code was just sent. Wait a minute before asking for another.'
export const REOPEN_CODE_NOT_SENT = 'We couldn’t send the code. Try again in a moment.'

const DAY_MS = 24 * 60 * 60_000
// Each plan has its own code bucket, so these caps count every plan of the account together.
const MAX_SENDS_PER_DAY = 20
const MAX_WRONG_GUESSES_PER_DAY = 50
const ownCodes = (customerId: string, now: number) => ({ actorType: 'customer', actorId: customerId, purpose: { startsWith: 'plan_reopen:' }, createdAt: { gt: new Date(now - DAY_MS) } })

const purposeFor = (planId: string): ResetPurpose => `plan_reopen:${planId}`

type Customer = { id: string; phone: string; firstName: string; email?: string | null; emailVerifiedAt?: Date | null }
export type CodeChannel = 'email' | 'sms'
/** What the code is for: a matured plan rolling over, or a collected plan starting again. */
export type ReopenKind = 'rollover' | 'again'
type Sender = (c: Customer, code: string, byAgent: boolean, channels: CodeChannel[], kind: ReopenKind) => Promise<CodeChannel | null>

/** The order to try: online + confirmed email → email then SMS; otherwise SMS first, email only as the backup. */
export function codeChannels(c: { online: boolean; hasConfirmedEmail: boolean }): CodeChannel[] {
  if (c.online && c.hasConfirmedEmail) return ['email', 'sms']
  return c.hasConfirmedEmail ? ['sms', 'email'] : ['sms']
}

async function deliver(c: Customer, code: string, byAgent: boolean, channels: CodeChannel[], kind: ReopenKind): Promise<CodeChannel | null> {
  const what = kind === 'rollover' ? 'roll over your plan' : 'save into your plan again'
  const warn = byAgent ? `Give it to your agent only if you asked to ${what}.` : 'Do not share it.'
  for (const ch of channels) {
    if (ch === 'sms') {
      // sms: roll-over / save-again code: cash customers always; online only as a backup to a confirmed email
      const sms = await sendSMS(c.phone, `Vochus Easy Save: your code to ${what} is ${code}. Valid 10 minutes. ${warn}`).catch(() => ({ success: false }))
      if (sms.success) return 'sms'
    } else if (c.email && c.emailVerifiedAt) {
      try {
        await sendMail({
          to: c.email,
          subject: kind === 'rollover' ? 'Your Vochus Easy Save code to roll over your plan' : 'Your Vochus Easy Save code to save again',
          html: `<p>Hi ${escapeHtml(c.firstName)},</p><p>Your code to ${what} is:</p><p><strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes. ${warn}</p>`,
        })
        return 'email'
      } catch { /* try the next channel */ }
    }
  }
  return null
}

/** Sends a code for this plan, by the right channel for the customer. `reason` says why nothing was sent. */
export async function requestReopenCode(
  customer: Customer,
  planId: string,
  byAgent: boolean,
  send: Sender = deliver, // injectable for tests
  now: number = Date.now(),
): Promise<{ ok: true; resetId: string; sentTo: string; sentBy: CodeChannel } | { ok: false; reason: 'wait' | 'not_sent' }> {
  if ((await prisma.passwordResetOtp.count({ where: ownCodes(customer.id, now) })) >= MAX_SENDS_PER_DAY) return { ok: false, reason: 'wait' }
  const plan = await prisma.savingsPlan.findFirst({ where: { id: planId, customerId: customer.id }, select: { source: true, status: true } })
  const channels = codeChannels({ online: plan?.source === 'self', hasConfirmedEmail: !!customer.email && !!customer.emailVerifiedAt })
  const kind: ReopenKind = plan?.status === 'Redeemed' ? 'again' : 'rollover'
  const issued = await issueResetCode('customer', customer.id, now, purposeFor(planId))
  if (!issued) return { ok: false, reason: 'wait' }
  const sentBy = await send(customer, issued.code, byAgent, channels, kind).catch(() => null)
  if (!sentBy) {
    await cancelResetCode(issued.id)
    return { ok: false, reason: 'not_sent' }
  }
  return { ok: true, resetId: issued.resetId, sentBy, sentTo: sentBy === 'email' && customer.email ? maskTarget('email', customer.email) : maskTarget('sms', customer.phone) }
}

/** True once, for the right code on this plan. */
export async function confirmReopenCode(customerId: string, planId: string, resetId: string, code: string, now: number = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code) || !resetId) return false
  const guessed = await prisma.passwordResetOtp.aggregate({ where: ownCodes(customerId, now), _sum: { attempts: true } })
  if ((guessed._sum.attempts ?? 0) >= MAX_WRONG_GUESSES_PER_DAY) return false
  return (await redeemResetCode('customer', customerId, resetId, code, now, purposeFor(planId))) !== null
}
