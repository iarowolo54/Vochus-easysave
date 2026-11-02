import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { money } from '@/lib/wallet-guard'
import { creditRegistrationReward } from '@/lib/reward'
import { verifyTransaction } from '@/lib/paystack'
import { creditAutoDebitAttempt } from '@/lib/auto-debit-credit'
import { consumePaymentIntent, parseCoversKeys } from '@/lib/payment-intent'

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

  const existing = await prisma.transaction.findUnique({ where: { ref: reference } })
  if (existing) return NextResponse.json({ ok: true })

  // Customer self-pay: credit savings plan
  if (customerId) {
    const amount = money(txData.amount / 100)

    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) return NextResponse.json({ ok: true })

    // Prefer the plan pinned at initiation (meta.planId). With no planId, credit
    // the sole Active plan; if there are several, we can't reject an already-paid
    // transaction, so credit the newest but flag it (initiation should pin a plan).
    const planId = meta.planId as string | undefined
    let plan = planId
      ? await prisma.savingsPlan.findFirst({ where: { id: planId, customerId, status: 'Active' } })
      : null
    if (!plan && !planId) {
      const active = await prisma.savingsPlan.findMany({ where: { customerId, status: 'Active' }, orderBy: { startDate: 'desc' }, take: 2 })
      if (active.length > 1) {
        console.warn(`[paystack webhook] no meta.planId for customer ${customerId} with multiple active plans — crediting newest`)
      }
      plan = active[0] ?? null
    }
    if (!plan) return NextResponse.json({ ok: true })

    const agent = await prisma.agent.findUnique({ where: { id: customer.agentId } })
    if (!agent) return NextResponse.json({ ok: true })

    const priorSavings = await prisma.transaction.count({ where: { customerId, type: 'saving' } })

    // If this webhook beats the browser's verify callback, it must also do verify's other work: consume
    // the intent and record the days paid for, or auto-debit would charge them again. Days come from the
    // server-side intent, never Paystack metadata, and only if the payment matches what was initiated.
    const intent = await prisma.paymentIntent.findFirst({ where: { ref: reference, customerId } })
    const matchesIntent = !!intent && intent.planId === plan.id && money(intent.amount) === amount
      && (!txData.currency || txData.currency === intent.currency)
    if (intent && !matchesIntent && intent.coversKeys) {
      console.warn(`[paystack webhook] payment does not match its intent, crediting without coverage ref=${reference}`)
    }
    const coversKeys = matchesIntent ? parseCoversKeys(intent.coversKeys) : []
    const creditedPlanId = plan.id

    try {
      await prisma.$transaction(async (tx) => {
        if (intent) {
          const consumed = await consumePaymentIntent(tx, reference, { customerId })
          if (!consumed) throw new Error('ALREADY_PROCESSED')
        }
        await tx.transaction.create({
          data: {
            ref: reference,
            agentId: agent.id,
            customerId,
            planId: creditedPlanId,
            type: 'saving',
            amount,
            method: 'Paystack',
            status: 'Done',
            note: `Customer self-pay via Paystack webhook — ${txData.channel ?? 'card'}`,
          },
        })
        await tx.savingsPlan.update({
          where: { id: creditedPlanId },
          data: { balance: { increment: amount } },
        })
        await tx.customerPayment.create({
          data: {
            ref: `PAY-${reference}`,
            customerId,
            planId: creditedPlanId,
            amount,
            status: 'Done',
            channel: txData.channel ?? 'card',
          },
        })
        for (const coversKey of coversKeys) {
          await tx.planDayCoverage.upsert({
            where: { savingsPlanId_coversKey: { savingsPlanId: creditedPlanId, coversKey } },
            create: { savingsPlanId: creditedPlanId, coversKey, ref: reference },
            update: {},
          })
        }
      })
    } catch (e: unknown) {
      // The verify callback got there first: it credited this payment and wrote its coverage.
      if (e instanceof Error && e.message === 'ALREADY_PROCESSED') return NextResponse.json({ ok: true })
      if ((e as { code?: unknown } | null)?.code !== 'P2002') throw e
    }

    logAudit({
      action: 'customer_paystack_payment',
      entity: 'Transaction',
      details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) paid ₦${amount.toLocaleString()} via Paystack webhook — ref ${reference}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })

    if (priorSavings === 0) creditRegistrationReward(customer).catch(() => {})

    return NextResponse.json({ ok: true })
  }

  // Agent wallet funding
  if (!agentId) return NextResponse.json({ ok: true })

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ ok: true })

  const amount = txData.amount / 100
  const walletAfter = agent.walletBalance + amount

  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ref: reference,
        agentId: agent.id,
        type: 'wallet_funding',
        amount,
        method: 'Paystack',
        status: 'Done',
        note: `Paystack webhook — ${txData.channel ?? 'card'}`,
        walletAfter,
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: { walletBalance: { increment: amount } },
    }),
  ])

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
