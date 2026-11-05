import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEnv } from '@/lib/env'
import { createTransferIntent } from '@/lib/transfer-intent'
import { money } from '@/lib/wallet-guard'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const input = (body && typeof body === 'object' ? body : {}) as { amount?: unknown }
  const amount = money(Number(input.amount))
  if (!(amount >= 100)) return NextResponse.json({ error: 'The smallest top-up is ₦100.' }, { status: 400 })
  // The kobo is ours to assign; an agent can't choose the figure they will be matched on.
  if (!Number.isInteger(amount)) return NextResponse.json({ error: 'Enter a whole-naira amount.' }, { status: 400 })
  if (amount > 10_000_000) return NextResponse.json({ error: 'That amount is too large for one transfer.' }, { status: 400 })

  const intent = await createTransferIntent({ actor: { agentId: agent.id }, planId: null, baseAmount: amount })
  if (!intent) return NextResponse.json({ error: 'Lots of people are paying right now. Please try again in a few minutes.' }, { status: 503 })

  logAudit({
    action: 'agent_wallet_topup_initiated',
    entity: 'PaymentIntent',
    details: `Agent ${agent.name} (${agent.agentId}) started a bank-transfer wallet top-up of ₦${intent.payAmount.toFixed(2)} — ref ${intent.ref}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({
    ref: intent.ref,
    payAmount: intent.payAmount,
    expiresAt: intent.expiresAt.toISOString(),
    account: {
      bank: 'Moniepoint',
      number: requireEnv('MONIEPOINT_ACCOUNT_NUMBER'),
      name: requireEnv('MONIEPOINT_ACCOUNT_NAME'),
    },
  })
}
