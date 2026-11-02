import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { PaystackRejected, verifyTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'
import { ConflictError, redemptionCompletionOps } from '@/lib/redemption-complete'
import { reopenPlanAfterNoTransfer } from '@/lib/redemption-balance'

// Resolves a redemption left in Processing: the approve call lost contact with Paystack, or the ledger
// write failed after the transfer. The plan is closed and nothing else moves this record on.
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const admin = guard.session.user as { id?: string; name?: string }
  const decidedBy = admin.name ?? 'Super Admin'

  const { id } = await context.params
  const record = await prisma.earlyRedemption.findUnique({
    where: { id },
    include: { savingsPlan: { select: { customer: { select: { id: true, agentId: true } } } } },
  })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.status !== 'Processing') return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  // Paystack saying it has no such transfer means none was made. Any other refusal or failure tells us nothing.
  let status: string
  let transferCode: string | null = null
  try {
    const result = await verifyTransfer(record.ref)
    status = result.status
    transferCode = typeof result.raw?.transfer_code === 'string' ? result.raw.transfer_code : null
  } catch (err) {
    if (!(err instanceof PaystackRejected && /not found/i.test(err.message))) {
      return NextResponse.json({ error: 'We couldn’t get an answer from Paystack. Nothing has changed. Try again shortly.' }, { status: 502 })
    }
    status = 'not_found'
  }

  let newStatus = 'Processing'
  try {
    if (status === 'failed' || status === 'reversed' || status === 'not_found') {
      // No money left, so the request goes back to the admin to approve again or reject.
      await prisma.$transaction(async (tx) => {
        const rel = await tx.earlyRedemption.updateMany({
          where: { id, status: 'Processing' },
          data: { status: 'AgentApproved', bankTransferStatus: status === 'not_found' ? null : status },
        })
        if (rel.count === 0) throw new ConflictError()
        await reopenPlanAfterNoTransfer(tx, record.savingsPlanId, record.balance, 'Active')
      })
      newStatus = 'AgentApproved'
    } else if (status === 'otp') {
      const moved = await prisma.earlyRedemption.updateMany({
        where: { id, status: 'Processing' },
        data: { status: 'AwaitingOTP', bankTransferStatus: status, paystackTransferCode: transferCode },
      })
      if (moved.count === 0) throw new ConflictError()
      newStatus = 'AwaitingOTP'
    } else {
      // Accepted, so complete it the way approve does when Paystack answers straight away.
      const { agentId, id: customerId } = record.savingsPlan.customer
      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { walletBalance: true } })
      await prisma.$transaction((tx) =>
        redemptionCompletionOps(tx, record, agentId, customerId, {
          decidedBy,
          isBankTransfer: true,
          bankTransferStatus: status,
          paystackRecipientCode: record.paystackRecipientCode,
          paystackTransferCode: transferCode ?? record.paystackTransferCode,
          claimFrom: 'Processing',
          walletAfter: agent?.walletBalance ?? 0,
        }),
      )
      newStatus = 'Approved'
    }
  } catch (err) {
    if (err instanceof ConflictError) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    throw err
  }

  logAudit({
    action: 'early_redemption_verify',
    entity: 'EarlyRedemption',
    entityId: id,
    details: `${decidedBy} checked ${record.ref} with Paystack: ${status}, now ${newStatus}`,
    actorType: 'admin',
    actorId: admin.id,
    actorName: decidedBy,
  })

  return NextResponse.json({ ok: true, status: newStatus, bankTransferStatus: status === 'not_found' ? null : status })
}
