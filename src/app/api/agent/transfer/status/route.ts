import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { INTENT_DONE, INTENT_PENDING, INTENT_REVIEW, INTENT_SUPERSEDED } from '@/lib/payment-intent'
import { pollIfStale } from '@/lib/moniepoint-poll'
import { TRANSFER_GRACE_MS, TRANSFER_METHOD } from '@/lib/transfer-intent'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true, walletBalance: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  const find = () => prisma.paymentIntent.findFirst({ where: { ref, agentId: agent.id, method: TRANSFER_METHOD } })
  let intent = await find()
  if (!intent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (intent.status === INTENT_PENDING) {
    // Best effort: if Gmail can't be reached the cron backstop still credits the payment.
    await pollIfStale().catch(() => {})
    intent = (await find()) ?? intent
  }

  if (intent.status === INTENT_DONE) {
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id }, select: { walletBalance: true } })
    return NextResponse.json({ status: 'done', amount: intent.amount, newBalance: fresh?.walletBalance ?? agent.walletBalance })
  }
  if (intent.status === INTENT_SUPERSEDED) {
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id }, select: { walletBalance: true } })
    return NextResponse.json({ status: 'closed', newBalance: fresh?.walletBalance ?? agent.walletBalance })
  }
  if (intent.status === INTENT_REVIEW) return NextResponse.json({ status: 'review' })
  const closes = (intent.expiresAt?.getTime() ?? 0) + TRANSFER_GRACE_MS
  return NextResponse.json({ status: Date.now() > closes ? 'expired' : 'pending' })
}
