import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { daysNotBought, settleIntentPayment } from '@/lib/customer-settle'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reference } = await req.json()
  if (!reference) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  logAudit({
    action: 'payment_verify_attempted',
    entity: 'Transaction',
    details: `Customer (${session.customerId}) submitted verification for ref ${reference}`,
    actorType: 'customer',
    actorId: session.id,
    actorName: session.name,
  })

  const alreadyProcessed = async () => {
    const tx = await prisma.transaction.findUnique({ where: { ref: reference }, select: { amount: true, planId: true, customerId: true } })
    if (!tx) return null
    // Only the payer sees the details of this payment.
    if (tx.customerId !== session.id) return NextResponse.json({ alreadyProcessed: true })
    const [plan, notBought] = await Promise.all([
      tx.planId ? prisma.savingsPlan.findUnique({ where: { id: tx.planId }, select: { balance: true } }) : null,
      daysNotBought(prisma, reference, session.id),
    ])
    return NextResponse.json({ alreadyProcessed: true, amount: tx.amount, newBalance: plan?.balance, notBought })
  }

  const processed = await alreadyProcessed()
  if (processed) return processed

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  })
  const data = await res.json()

  // Not settled yet, such as a bank transfer still on its way. It hasn't failed, and the webhook credits it when it
  // lands, so say so rather than showing a failure the customer might pay again to fix.
  if (data.status && ['pending', 'ongoing', 'processing', 'queued'].includes(data.data?.status)) {
    return NextResponse.json({ pending: true })
  }

  if (!data.status || data.data?.status !== 'success') {
    logAudit({
      action: 'payment_verify_failed',
      entity: 'Transaction',
      details: `Customer (${session.customerId}) verification failed for ref ${reference} — Paystack status: ${data.data?.status ?? 'unknown'}`,
      actorType: 'customer',
      actorId: session.id,
      actorName: session.name,
    })
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 })
  }

  const txData = data.data

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The server-side intent is the authority on who and which plan. This reference must be one this server
  // initiated for THIS customer; an arbitrary reference is rejected.
  const intent = await prisma.paymentIntent.findFirst({ where: { ref: reference, customerId: customer.id } })
  if (!intent) return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })

  // Same rule as the webhook, which may have settled this during the Paystack fetch above.
  const result = await settleIntentPayment(prisma, {
    intent,
    reference,
    amountNaira: txData.amount / 100,
    currency: txData.currency,
    channel: txData.channel,
    via: 'Paystack',
  })

  if (result.kind === 'review') return NextResponse.json({ review: true })
  if (result.kind === 'already') return (await alreadyProcessed()) ?? NextResponse.json({ alreadyProcessed: true })

  const [updated, notBought] = await Promise.all([
    prisma.savingsPlan.findUnique({ where: { id: result.planId }, select: { balance: true } }),
    daysNotBought(prisma, reference, customer.id),
  ])
  return NextResponse.json({ amount: result.amount, newBalance: updated?.balance, notBought })
}
