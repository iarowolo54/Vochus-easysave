import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { money } from '@/lib/wallet-guard'
import { verifyTransaction } from '@/lib/paystack'
import { creditAutoDebitAttempt } from '@/lib/auto-debit-credit'
import { sendToReview, settleIntentPayment } from '@/lib/customer-settle'
import { INTENT_PENDING, INTENT_REVIEW, REVIEW_ACTION, consumePaymentIntent } from '@/lib/payment-intent'
import { handleTransferEvent, isTransferEvent } from '@/lib/paystack-transfer-event'
import { reverifyCharge } from '@/lib/webhook-reverify'
import { ensureEnrolmentMandate, isEnrolmentRef } from '@/lib/auto-debit-enrol'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('x-paystack-signature') ?? ''
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET
  // Fail closed: never verify against an empty secret (an empty HMAC key is forgeable).
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })

  const expected = crypto.createHmac('sha512', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body)

  logAudit({
    action: 'paystack_webhook_received',
    entity: 'Transaction',
    details: `Paystack webhook received — event: ${event.event}, ref: ${event.data?.reference ?? 'N/A'}, amount: ₦${event.data?.amount ? (event.data.amount / 100).toLocaleString() : 'N/A'}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })

  // Payout outcomes. Without this a bank payout never leaves "pending", and a failure goes unrecorded.
  if (isTransferEvent(event.event)) {
    try {
      await handleTransferEvent(prisma, event.event, event.data)
    } catch (e: unknown) {
      // Not swallowed: a 5xx makes Paystack redeliver, and recording the status is safe to repeat.
      console.error('[paystack webhook] transfer event failed:', e instanceof Error ? e.message : 'unknown error')
      return NextResponse.json({ error: 'Could not record the transfer' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (event.event !== 'charge.success') return NextResponse.json({ ok: true })

  const txData = event.data
  const reference = txData.reference as string
  // The gift card app shares this Paystack account, so its charges arrive here too. They are not
  // savings payments: never credit them (migrated gift card customers share ids with EasySave).
  if (typeof reference === 'string' && reference.startsWith('VCHS-GC-')) return NextResponse.json({ ok: true })
  const meta = txData.metadata ?? {}
  const agentId = meta.agentId as string | undefined
  const customerId = meta.customerId as string | undefined

  // Scheduled auto-debit charges ('autodebit-'): credit the attempt's contribution, NOT the grossed-up
  // charge. Must run before the generic customer self-pay branch below. ('addenroll-' enrollment refs
  // intentionally fall through to the generic branch.)
  if (reference.startsWith('autodebit-')) {
    try {
      // Never trust the webhook body for crediting: re-verify with Paystack.
      const verified = await verifyTransaction(reference)
      if (verified.status === 'success') {
        const attempt = await prisma.autoDebitAttempt.findUnique({ where: { reference } })
        if (attempt) {
          // Test mode verifies with amount 0, so only enforce amount/currency when a real amount came back.
          const hasAmount = verified.amountNaira > 0
          const ok = !hasAmount || (verified.currency === 'NGN' && verified.amountNaira >= attempt.creditAmount)
          if (ok) {
            await creditAutoDebitAttempt(prisma, {
              reference,
              settledAmountNaira: hasAmount ? verified.amountNaira : attempt.grossCharged,
            })
          } else {
            // Breadcrumb for reconciliation; the cron sweep still recovers it. No auth code / body.
            console.warn(`[paystack webhook] autodebit credit skipped (amount/currency mismatch) attempt=${attempt.id} reference=${reference}`)
          }
        }
      }
    } catch (e: unknown) {
      // Swallow so Paystack gets a 200; the reconciliation sweep recovers anything missed.
      console.error('auto-debit webhook credit failed:', e instanceof Error ? e.message : 'unknown error')
    }
    return NextResponse.json({ ok: true })
  }

  // Already credited. An auto-funding signup carries on, because the money can be saved with no mandate yet.
  const existing = await prisma.transaction.findUnique({ where: { ref: reference } })
  if (existing && !isEnrolmentRef(reference)) return NextResponse.json({ ok: true })

  // The server-side intent is the authority on who and which plan, over Paystack metadata.
  const intent = await prisma.paymentIntent.findUnique({ where: { ref: reference } })

  // Never credit on the signed body alone: Paystack must confirm the charge is successful, in naira, for this amount.
  let confirmed: Awaited<ReturnType<typeof reverifyCharge>>
  try {
    confirmed = await reverifyCharge(reference, { amountNaira: money(txData.amount / 100), currency: txData.currency })
  } catch (e: unknown) {
    // Not swallowed: a 5xx makes Paystack redeliver once it can be reached again.
    console.error('[paystack webhook] could not re-verify with Paystack:', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not verify the payment' }, { status: 502 })
  }
  if (confirmed.kind === 'not-successful') {
    logAudit({
      action: 'paystack_webhook_unconfirmed',
      entity: 'Transaction',
      details: `Not credited: the webhook said success but Paystack says ${confirmed.status} — ref ${reference}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })
    return NextResponse.json({ ok: true })
  }
  if (confirmed.kind === 'mismatch') {
    const reason = `${confirmed.reason} — ref ${reference}`
    if (intent?.actorType) await sendToReview(prisma, intent, reference, reason)
    else await logAudit({ action: REVIEW_ACTION, entity: 'Transaction', details: `Not credited, needs manual review: ${reason}`, actorType: 'system', actorName: 'Paystack Webhook' })
    return NextResponse.json({ ok: true })
  }

  if (intent?.actorType === 'customer') {
    const settled = await settleIntentPayment(prisma, {
      intent,
      reference,
      amountNaira: confirmed.amountNaira,
      currency: confirmed.currency,
      channel: txData.channel,
      via: 'Paystack webhook',
    })
    // The webhook can win the race against the customer's verify callback, which is what normally saves the card.
    if (isEnrolmentRef(reference) && settled.kind !== 'review') {
      try {
        await ensureEnrolmentMandate(prisma, reference, confirmed.authorization)
      } catch (e: unknown) {
        console.error('[paystack webhook] could not create the auto-funding mandate:', e instanceof Error ? e.message : 'unknown error')
        return NextResponse.json({ error: 'Could not finish the signup' }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true })
  }

  // From here on the money has not been credited yet, so an already-recorded ref is done.
  if (existing) return NextResponse.json({ ok: true })

  // A customer charge with no intent. Every payment this app starts for a customer creates an intent first, so this
  // one was not started by us (another app on the shared Paystack account, or a charge built by hand with metadata
  // naming a customer). It is never credited, and never earns the registration reward: staff decide from the audit log.
  if (customerId && !intent) {
    await logAudit({
      action: REVIEW_ACTION,
      entity: 'Transaction',
      details: `Not credited, needs manual review: a charge of ₦${confirmed.amountNaira} named customer ${customerId} but no payment was started for it — ref ${reference}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })
    console.warn(`[paystack webhook] charge with no intent needs manual review ref=${reference}`)
    return NextResponse.json({ ok: true })
  }

  // Agent wallet funding. The intent made when the top-up was started says whose wallet and how much; the
  // charge's own metadata never decides that, so a charge we didn't start can't fund a wallet.
  if (intent?.actorType !== 'agent' || !intent.agentId) {
    if (agentId) {
      await logAudit({
        action: REVIEW_ACTION,
        entity: 'Transaction',
        details: `Not credited, needs manual review: a wallet charge of ₦${confirmed.amountNaira} named agent ${agentId} but no top-up was started for it — ref ${reference}`,
        actorType: 'system',
        actorName: 'Paystack Webhook',
      })
    }
    return NextResponse.json({ ok: true })
  }
  if (intent.status === INTENT_REVIEW) return NextResponse.json({ ok: true })
  if (intent.status !== INTENT_PENDING) return NextResponse.json({ ok: true })

  const agent = await prisma.agent.findUnique({ where: { id: intent.agentId } })
  if (!agent) {
    await sendToReview(prisma, intent, reference, `agent ${intent.agentId} not found, amount ₦${confirmed.amountNaira}`)
    return NextResponse.json({ ok: true })
  }
  if (confirmed.currency !== intent.currency || money(confirmed.amountNaira) !== money(intent.amount)) {
    await sendToReview(prisma, intent, reference, `paid ${confirmed.currency} ${confirmed.amountNaira}, the top-up was for ${intent.currency} ${intent.amount}`)
    return NextResponse.json({ ok: true })
  }

  const amount = money(intent.amount)
  const agentDbId = agent.id
  try {
    await prisma.$transaction(async (tx) => {
      // Atomically consume the intent; a losing or replayed delivery must not credit.
      if (!await consumePaymentIntent(tx, reference, { agentId: agentDbId })) throw new Error('ALREADY_PROCESSED')
      const updated = await tx.agent.update({
        where: { id: agentDbId },
        data: { walletBalance: { increment: amount } },
        select: { walletBalance: true },
      })
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: agentDbId,
          type: 'wallet_funding',
          amount,
          method: 'Paystack',
          status: 'Done',
          note: `Paystack webhook — ${txData.channel ?? 'card'}`,
          walletAfter: updated.walletBalance,
        },
      })
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_PROCESSED') return NextResponse.json({ ok: true })
    // The verify route credited this ref first.
    if ((e as { code?: unknown } | null)?.code === 'P2002' && await prisma.transaction.findUnique({ where: { ref: reference }, select: { id: true } })) {
      return NextResponse.json({ ok: true })
    }
    throw e
  }

  logAudit({
    action: 'agent_wallet_funded_webhook',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) wallet funded ₦${amount.toLocaleString()} via Paystack webhook — ref ${reference}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })

  return NextResponse.json({ ok: true })
}
