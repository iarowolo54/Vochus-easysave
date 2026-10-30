import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { isValidAmount, MAX_ADMIN_FUND } from '@/lib/wallet-guard'

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body: unknown = await req.json().catch(() => null)
  const { agentId, amount } = (body && typeof body === 'object' ? body : {}) as { agentId?: unknown; amount?: unknown }

  if (typeof agentId !== 'string' || !agentId || !isValidAmount(amount, MAX_ADMIN_FUND)) {
    return NextResponse.json({ error: `agentId and an amount between 0.01 and ${MAX_ADMIN_FUND} are required` }, { status: 400 })
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
    ...adminActor(session),
  })

  return NextResponse.json({ agent: updated })
}
