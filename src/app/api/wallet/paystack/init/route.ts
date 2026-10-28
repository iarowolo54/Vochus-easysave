import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createPaymentIntent } from '@/lib/payment-intent'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const amount = parseFloat(body.amount)
  if (!amount || amount < 100) return NextResponse.json({ error: 'Minimum top-up is ₦100' }, { status: 400 })

  const email = agent.email ?? `${agent.agentId.toLowerCase()}@vochus.ng`
  const rand = randomBytes(9).toString('base64url').toUpperCase()
  const ref = `VCHS-${agent.agentId}-${Date.now()}-${rand}`

  // Bind this reference to the agent + amount server-side; verify requires it.
  await createPaymentIntent({ ref, actorType: 'agent', agentId: agent.id, amount })

  logAudit({
    action: 'agent_wallet_topup_initiated',
    entity: 'Transaction',
    details: `Agent ${agent.name} (${agent.agentId}) initiated Paystack wallet top-up of ₦${amount.toLocaleString()} — ref ${ref}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ reference: ref, email, amount })
}
