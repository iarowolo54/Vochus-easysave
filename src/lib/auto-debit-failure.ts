import { emailAction } from '@/lib/email-brand'
import { emailMessage } from '@/lib/email-template'
import type { PrismaClient } from '@prisma/client'
import { pauseMandate } from '@/lib/auto-debit'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { INTENT_DONE, parseCoversKeys } from '@/lib/payment-intent'
import { inFlightKeys } from '@/lib/pay-ahead'

type Client = Pick<PrismaClient, 'paymentIntent' | 'planDayCoverage' | 'auditLog' | 'autoDebitMandate' | 'autoDebitAttempt' | 'savingsPlan' | 'customer'>

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
        ...emailMessage({
          subject: 'Your auto-debit is paused',
          preheader: 'Recent card payments did not go through.',
          tone: 'warning',
          statusLabel: '',
          heading: `Hi ${c.firstName}, your auto-debit is paused`,
          intro: 'Recent card payments did not go through, so we paused it.',
          nextStep: 'To turn it back on, open your savings plan in the app and set up auto-debit again.',
          action: emailAction('Open Vochus Easy Save', '/customer/login'),
          rows: [],
        }),
      })
    } else if (c.phone) {
      // sms: online customer with no email at all (email otherwise)
      await sendSMS(c.phone, `Hi ${c.firstName}, ${text}`)
    }
  } catch {
    // best-effort: a failed notification must never affect the pause result
  }
}

/**
 * A customer's payment gave way to this charge while it was processing, so it wrote no coverage for the day. Now the
 * charge has failed, that day is unpaid though they paid for it. Their money is safe in savings; flag it for staff.
 * Best-effort, like the notification.
 */
async function auditYieldedPayments(client: Client, attempt: { savingsPlanId: string; cycleDate: Date; reference: string }): Promise<void> {
  try {
    const plan = await client.savingsPlan.findUnique({ where: { id: attempt.savingsPlanId }, select: { cadence: true, startDate: true } })
    const [key] = plan ? inFlightKeys(plan, [attempt]) : []
    if (!key) return
    const covered = await client.planDayCoverage.findFirst({ where: { savingsPlanId: attempt.savingsPlanId, coversKey: key }, select: { id: true } })
    if (covered) return
    const intents = await client.paymentIntent.findMany({
      where: { planId: attempt.savingsPlanId, status: INTENT_DONE, coversKeys: { contains: key } },
      select: { ref: true, coversKeys: true },
    })
    for (const intent of intents) {
      if (!parseCoversKeys(intent.coversKeys).includes(key)) continue
      await client.auditLog.create({
        data: {
          action: 'payment_yielded_to_failed_charge',
          entity: 'Transaction',
          details: `Payment ${intent.ref} gave way to auto-debit ${attempt.reference} for ${key}, which then failed. The day is unpaid; the money is in savings.`,
          actorType: 'system',
          actorName: 'Auto-debit',
        },
      })
    }
  } catch {
    // best-effort: must never affect recording the failure
  }
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

  await auditYieldedPayments(client, attempt)

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
