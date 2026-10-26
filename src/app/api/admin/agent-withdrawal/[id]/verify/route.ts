import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { verifyTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const agent = await prisma.agent.findUnique({ where: { id: record.agentId } })
  const admin = session.user as { name?: string }
  const decidedBy = admin.name ?? 'Super Admin'

  let newStatus = record.status
  if (result.status === 'success') newStatus = 'Approved'
  else if (result.status === 'failed' || result.status === 'reversed') {
    newStatus = 'Rejected'
    if (agent && ['Processing', 'AwaitingOTP'].includes(record.status)) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { commissionBalance: { increment: record.amount } },
      })
    }
  } else if (result.status === 'pending') newStatus = 'Processing'

  await prisma.agentWithdrawal.update({
    where: { id },
    data: {
      status: newStatus,
      bankTransferStatus: result.status,
      ...(newStatus === 'Approved' && !record.decidedAt ? { decidedAt: new Date(), decidedBy } : {}),
      ...(newStatus === 'Rejected' ? { decidedAt: new Date(), decidedBy, adminNote: `Auto-refund: Paystack ${result.status}` } : {}),
    },
  })

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
