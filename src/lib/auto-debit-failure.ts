import type { PrismaClient } from '@prisma/client'
import { pauseMandate } from '@/lib/auto-debit'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'

type Client = Pick<PrismaClient, 'autoDebitMandate' | 'autoDebitAttempt' | 'savingsPlan' | 'customer'>

export const MAX_CONSECUTIVE_FAILURES = 3

// Card errors a retry cannot fix: pause at once instead of waiting for repeated failures.
const UNRECOVERABLE = /expired|invalid|do not honou?r|blacklisted/i

/**
 * Tell the customer auto-debit is paused. Email if they have one, else SMS. Best-effort:
 * never throws. Real sends happen only when NODE_ENV === 'production': sendSMS gates itself,
 * sendMail does not, so email is gated here. The message carries no card/auth data or gateway text.
 */
async function notifyPaused(client: Client, mandateId: string): Promise<void> {
  try {
    const mandate = await client.autoDebitMandate.findUnique({ where: { id: mandateId }, select: { customerId: true } })
    if (!mandate) return
    const c = await client.customer.findUnique({
      where: { id: mandate.customerId },
      select: { email: true, phone: true, firstName: true },
    })
    if (!c) return
    const text = 'Your Vochus Easy Save auto-debit is paused because recent card payments did not go through. To turn it back on, open your savings plan in the app and set up auto-debit again.'
    if (c.email) {
      // sendMail has no environment gate of its own (sendSMS does), so gate here.
      if (process.env.NODE_ENV !== 'production') return
      await sendMail({
        to: c.email,
        subject: 'Your auto-debit is paused',
        html: `<p>Hi ${escapeHtml(c.firstName)},</p><p>${text}</p>`,
      })
    } else if (c.phone) {
      await sendSMS(c.phone, `Hi ${c.firstName}, ${text}`)
    }
  } catch {
    // best-effort: a failed notification must never affect the pause result
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/**
 * Record a failed auto-debit charge. Idempotent per attempt reference: an attempt
 * already marked failed is not counted twice. Pauses the mandate immediately on an
 * unrecoverable card error, otherwise after MAX_CONSECUTIVE_FAILURES in a row.
 */
export async function recordAutoDebitFailure(
  client: Client,
  input: { reference: string; gatewayResponse: string },
): Promise<{ paused: boolean }> {
  const attempt = await client.autoDebitAttempt.findUnique({ where: { reference: input.reference } })
  if (!attempt) return { paused: false }

  if (attempt.status === 'failed') {
    const m = await client.autoDebitMandate.findUnique({ where: { id: attempt.mandateId }, select: { status: true } })
    return { paused: m?.status === 'paused' }
  }

  // Conditional flip so two concurrent callers cannot both count the same attempt.
  const flipped = await client.autoDebitAttempt.updateMany({
    where: { id: attempt.id, status: { not: 'failed' } },
    data: { status: 'failed', gatewayResponse: input.gatewayResponse },
  })
  if (flipped.count === 0) {
    const m = await client.autoDebitMandate.findUnique({ where: { id: attempt.mandateId }, select: { status: true } })
    return { paused: m?.status === 'paused' }
  }

  const mandate = await client.autoDebitMandate.update({
    where: { id: attempt.mandateId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { id: true, consecutiveFailures: true },
  })

  const pause = UNRECOVERABLE.test(input.gatewayResponse) || mandate.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
  if (pause) {
    await pauseMandate(client, mandate.id)
    await notifyPaused(client, mandate.id)
  }
  return { paused: pause }
}
