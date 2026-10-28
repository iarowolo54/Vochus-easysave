import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json()
  const { agentId, amount } = body as { agentId: string; amount: number }

  if (!agentId || !amount || amount <= 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const ref = `WF-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`
  const walletAfter = agent.walletBalance + amount

  const [updated] = await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: { walletBalance: { increment: amount } },
    }),
    prisma.transaction.create({
      data: {
        ref,
        agentId,
        type: 'wallet_funding',
        amount,
        method: 'Admin',
        status: 'Done',
        note: `Admin topped up agent capital`,
        walletAfter,
      },
    }),
  ])

  logAudit({
    action: 'wallet_admin_fund',
    entity: 'Wallet',
    entityId: agent.id,
    details: `Admin funded agent ${agent.name} (${agent.agentId}) wallet with ₦${amount} (ref ${ref})`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ agent: updated })
}
