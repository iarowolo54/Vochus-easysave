import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { INTENT_DONE, INTENT_PENDING, INTENT_REVIEW } from '@/lib/payment-intent'
import { pollIfStale } from '@/lib/moniepoint-poll'
import { TRANSFER_GRACE_MS, TRANSFER_METHOD } from '@/lib/transfer-intent'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  const find = () => prisma.paymentIntent.findFirst({ where: { ref, customerId: session.id, method: TRANSFER_METHOD } })
  let intent = await find()
  if (!intent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (intent.status === INTENT_PENDING) {
    // Looking is best effort: if Gmail can't be reached the cron backstop still credits the payment.
    await pollIfStale().catch(() => {})
    intent = (await find()) ?? intent
  }

  if (intent.status === INTENT_DONE) {
    const plan = intent.planId ? await prisma.savingsPlan.findUnique({ where: { id: intent.planId }, select: { balance: true } }) : null
    return NextResponse.json({ status: 'done', amount: intent.amount, newBalance: plan?.balance })
  }
  if (intent.status === INTENT_REVIEW) return NextResponse.json({ status: 'review' })
  const closes = (intent.expiresAt?.getTime() ?? 0) + TRANSFER_GRACE_MS
  return NextResponse.json({ status: Date.now() > closes ? 'expired' : 'pending' })
}
