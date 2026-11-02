import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { PaystackRejected, verifyTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'
import { ConflictError, redemptionCompletionOps } from '@/lib/redemption-complete'
import { NO_MONEY_LEFT, reopenPlanAfterNoTransfer, settlePlanAfterPayout } from '@/lib/redemption-balance'

// Resolves a redemption whose transfer is unsettled: approve lost contact with Paystack, the ledger write failed
// after the transfer, the code expired, or finalize got no clear answer. Nothing else moves these records on.
// Only a clear answer changes anything. Paid means success, nothing else; any status not named here is left.
const CHECKABLE = ['Processing', 'AwaitingOTP', 'Finalizing'] as const
type Checkable = (typeof CHECKABLE)[number]

// A transfer Paystack hasn't logged yet can still arrive (an approve may be running, or one timed out moments
// ago), so "not found" only counts once a started transfer has had time to appear.
const NOT_FOUND_AFTER_MS = 30 * 60 * 1000

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
  if (!CHECKABLE.includes(record.status as Checkable)) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
  const from = record.status as Checkable

  // Paystack saying it has no such transfer means none was made. Any other refusal or failure tells us nothing.
  let status: string
  let raw: { reference?: unknown; amount?: unknown; currency?: unknown; transfer_code?: unknown } | null = null
  try {
    const result = await verifyTransfer(record.ref)
    status = result.status
    raw = result.raw
  } catch (err) {
    if (!(err instanceof PaystackRejected && /not found/i.test(err.message))) {
      return NextResponse.json({ error: 'We couldn’t get an answer from Paystack. Nothing has changed. Try again shortly.' }, { status: 502 })
    }
    status = 'not_found'
  }

  // Only a transfer that was never confirmed can be missing; one we hold a code for exists.
  if (status === 'not_found' && (from !== 'Processing' || record.paystackTransferCode)) {
    return NextResponse.json({ ok: true, status: from, bankTransferStatus: record.bankTransferStatus })
  }
  if (status === 'not_found' && record.decidedAt && Date.now() - record.decidedAt.getTime() < NOT_FOUND_AFTER_MS) {
    return NextResponse.json({ error: 'Paystack has no record of this transfer yet. It may still appear, so check again in 30 minutes.' }, { status: 409 })
  }

  // The answer must be about this payout before anything is written. (raw is null only with a test key.)
  const wrongTransfer = raw && (raw.reference !== record.ref || (status === 'success' && (raw.amount !== Math.round(record.netPayout * 100) || raw.currency !== 'NGN')))
  if (wrongTransfer) {
    logAudit({
      action: 'early_redemption_verify_mismatch',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `MANUAL REVIEW: Paystack's answer for ${record.ref} (${status}) doesn't match this request's reference, amount or currency. Nothing changed.`,
      actorType: 'admin',
      actorId: admin.id,
      actorName: decidedBy,
    })
    return NextResponse.json({ error: 'Paystack’s record doesn’t match this request’s reference, amount or currency. Nothing has changed. This needs a manual check.' }, { status: 409 })
  }

  const transferCode = typeof raw?.transfer_code === 'string' ? raw.transfer_code : record.paystackTransferCode
  // decidedAt too: if this request was released and approved again while we waited, this answer is out of date.
  const claim = { id, status: from, decidedAt: record.decidedAt }
  let newStatus: string = from
  let reviewNeeded = false
  try {
    if (NO_MONEY_LEFT.includes(status) || status === 'not_found') {
      // No money left, so the request goes back to the admin to approve again or reject.
      await prisma.$transaction(async (tx) => {
        const rel = await tx.earlyRedemption.updateMany({
          where: claim,
          data: { status: 'AgentApproved', bankTransferStatus: status === 'not_found' ? null : status, decidedAt: null, paystackTransferCode: null },
        })
        if (rel.count === 0) throw new ConflictError()
        await reopenPlanAfterNoTransfer(tx, record.savingsPlanId, record.balance, 'Active')
      })
      newStatus = 'AgentApproved'
    } else if (status === 'otp' && transferCode && from === 'Processing') {
      // Never from Finalizing: a code may already have gone in, and going back would allow another try.
      const moved = await prisma.earlyRedemption.updateMany({
        where: claim,
        data: { status: 'AwaitingOTP', bankTransferStatus: status, paystackTransferCode: transferCode },
      })
      if (moved.count === 0) throw new ConflictError()
      newStatus = 'AwaitingOTP'
    } else if (status === 'success') {
      const { agentId, id: customerId } = record.savingsPlan.customer
      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { walletBalance: true } })
      reviewNeeded = await prisma.$transaction(async (tx) => {
        await redemptionCompletionOps(tx, record, agentId, customerId, {
          decidedBy,
          isBankTransfer: true,
          bankTransferStatus: status,
          paystackRecipientCode: record.paystackRecipientCode,
          paystackTransferCode: transferCode,
          claimFrom: from,
          walletAfter: agent?.walletBalance ?? 0,
        })
        return settlePlanAfterPayout(tx, record)
      })
      newStatus = 'Approved'
    } else {
      // Pending, blocked, rejected, otp we can't or mustn't act on, or a status we don't recognise. Not paid and not
      // released: it stays, and the admin screen says what Paystack said.
      await prisma.earlyRedemption.updateMany({ where: claim, data: { bankTransferStatus: status } })
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

  return NextResponse.json({ ok: true, status: newStatus, bankTransferStatus: status === 'not_found' ? null : status, reviewNeeded })
}
