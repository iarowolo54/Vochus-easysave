import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { verifyTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!record.paystackTransferCode) return NextResponse.json({ error: 'No Paystack transfer on this record' }, { status: 400 })

  let result: { status: string; raw: any }
  try {
    result = await verifyTransfer(record.ref)
  } catch (err: any) {
    return NextResponse.json({ error: `Verify failed: ${err.message}` }, { status: 502 })
  }

  const admin = session.user as { name?: string }
  const decidedBy = admin.name ?? 'Super Admin'

  // Only an in-flight transfer may change status; every transition is a conditional claim so a
  // refund (failed/reversed) can be applied at most once however many times verify is hit.
  const IN_FLIGHT = ['Processing', 'AwaitingOTP']
  const inFlight = IN_FLIGHT.includes(record.status)
  let newStatus = record.status

  if (result.status === 'failed' || result.status === 'reversed') {
    if (!inFlight) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    const refunded = await prisma.$transaction(async (tx) => {
      const claim = await tx.agentWithdrawal.updateMany({
        where: { id, status: { in: IN_FLIGHT } },
        data: {
          status: 'Rejected',
          bankTransferStatus: result.status,
          decidedAt: new Date(),
          decidedBy,
          adminNote: `Auto-refund: Paystack ${result.status}`,
        },
      })
      if (claim.count === 0) return false
      await tx.agent.update({
        where: { id: record.agentId },
        data: { commissionBalance: { increment: record.amount } },
      })
      return true
    })
    if (!refunded) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    newStatus = 'Rejected'
  } else {
    const target = result.status === 'success' ? 'Approved' : result.status === 'pending' ? 'Processing' : null
    if (target && inFlight) {
      const moved = await prisma.agentWithdrawal.updateMany({
        where: { id, status: { in: IN_FLIGHT } },
        data: {
          status: target,
          bankTransferStatus: result.status,
          ...(target === 'Approved' && !record.decidedAt ? { decidedAt: new Date(), decidedBy } : {}),
        },
      })
      newStatus = moved.count ? target : ((await prisma.agentWithdrawal.findUnique({ where: { id }, select: { status: true } }))?.status ?? record.status)
    } else {
      await prisma.agentWithdrawal.updateMany({ where: { id, status: record.status }, data: { bankTransferStatus: result.status } })
    }
  }

  logAudit({
    action: 'agent_withdrawal_verify',
    entity: 'AgentWithdrawal',
    entityId: record.id,
    details: `${decidedBy} verified ${record.ref}: Paystack=${result.status}, internal=${newStatus}`,
    actorType: 'superadmin',
    actorName: decidedBy,
  })

  return NextResponse.json({ ok: true, status: newStatus, bankTransferStatus: result.status, raw: result.raw })
}
