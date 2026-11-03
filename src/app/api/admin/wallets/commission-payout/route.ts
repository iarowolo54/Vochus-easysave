import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { money } from '@/lib/wallet-guard'

class PayoutConflict extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('treasury', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json()
  const agentId: unknown = body?.agentId

  if (typeof agentId !== 'string' || !agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Debit the exact stored value (float drift can leave it just below a 2dp figure, and a guard on the
  // rounded value would never match); the ledger/receipt show the clean 2dp display value.
  const raw = agent.commissionBalance
  const commAmt = money(raw)
  if (commAmt <= 0) return NextResponse.json({ error: 'No commission to pay out' }, { status: 400 })

  const ref = `COMM-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`

  // Conditional debits: each updateMany only matches while the balance still covers the amount, so
  // a concurrent payout (or a withdrawal that already took the commission) matches nothing and the
  // whole transaction rolls back. The agent is debited by the exact value read (not zeroed) so commission that
  // accrues meanwhile is not lost.
  try {
    await prisma.$transaction(async (tx) => {
      const agentDebit = await tx.agent.updateMany({
        where: { id: agentId, commissionBalance: { gte: raw } },
        data: { commissionBalance: { decrement: raw } },
      })
      if (agentDebit.count === 0) throw new PayoutConflict(409, 'Commission balance changed — refresh and retry')
      const floatDebit = await tx.platformWallet.updateMany({
        where: { type: 'Float', balance: { gte: commAmt } },
        data: { balance: { decrement: commAmt } },
      })
      if (floatDebit.count === 0) throw new PayoutConflict(400, 'Insufficient Float wallet for commission payout')
      await tx.transaction.create({
        data: {
          ref,
          agentId,
          type: 'commission_payout',
          amount: commAmt,
          method: 'Admin',
          status: 'Done',
          note: `Commission payout`,
        },
      })
    })
  } catch (err) {
    if (err instanceof PayoutConflict) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  logAudit({
    action: 'commission_payout',
    entity: 'Wallet',
    entityId: agent.id,
    details: `Commission payout ₦${commAmt} to agent ${agent.name} (${agent.agentId}) — ref ${ref}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ success: true, amount: commAmt })
}
