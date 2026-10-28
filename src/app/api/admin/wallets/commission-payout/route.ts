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
  const { agentId } = body as { agentId: string }

  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const commAmt = agent.commissionBalance
  if (commAmt <= 0) return NextResponse.json({ error: 'No commission to pay out' }, { status: 400 })

  const floatWallet = await prisma.platformWallet.findUnique({ where: { type: 'Float' } })
  if (!floatWallet || floatWallet.balance < commAmt) {
    return NextResponse.json({ error: 'Insufficient Float wallet for commission payout' }, { status: 400 })
  }

  const ref = `COMM-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: { commissionBalance: 0 },
    }),
    prisma.platformWallet.update({
      where: { type: 'Float' },
      data: { balance: { decrement: commAmt } },
    }),
    prisma.transaction.create({
      data: {
        ref,
        agentId,
        type: 'commission_payout',
        amount: commAmt,
        method: 'Admin',
        status: 'Done',
        note: `Commission payout`,
      },
    }),
  ])

  logAudit({
    action: 'commission_payout',
    entity: 'Wallet',
    entityId: agent.id,
    details: `Commission payout ₦${commAmt} to agent ${agent.name} (${agent.agentId}) — ref ${ref}`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ success: true, amount: commAmt })
}
