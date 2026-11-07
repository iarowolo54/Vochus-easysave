import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { PaystackRejected, verifyTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'
import { notifications, notify } from '@/lib/notifications'
import { NO_MONEY_LEFT } from '@/lib/redemption-balance'

// Same rules as the early-redemption verify: only a clear answer changes anything, and paid means success.
const IN_FLIGHT = ['Processing', 'AwaitingOTP', 'Finalizing']

// A transfer Paystack hasn't logged yet can still arrive, so "not found" only counts once it has had time to appear.
const NOT_FOUND_AFTER_MS = 30 * 60 * 1000

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('withdrawals', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const inFlight = IN_FLIGHT.includes(record.status)
  const neverConfirmed = record.status === 'Processing' && !record.paystackTransferCode
  if (!inFlight && !record.paystackTransferCode) return NextResponse.json({ error: 'No Paystack transfer on this record' }, { status: 400 })

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
  if (status === 'not_found' && !neverConfirmed) {
    return NextResponse.json({ ok: true, status: record.status, bankTransferStatus: record.bankTransferStatus })
  }
  if (status === 'not_found' && record.decidedAt && Date.now() - record.decidedAt.getTime() < NOT_FOUND_AFTER_MS) {
    return NextResponse.json({ error: 'Paystack has no record of this transfer yet. It may still appear, so check again in 30 minutes.' }, { status: 409 })
  }

  const admin = session.user as { name?: string }
  const decidedBy = guard.actor.name

  // The answer must be about this withdrawal before anything is written. (raw is null only with a test key.)
  const wrongTransfer = raw && (raw.reference !== record.ref || (status === 'success' && (raw.amount !== Math.round(record.amount * 100) || raw.currency !== 'NGN')))
  if (wrongTransfer) {
    logAudit({
      action: 'agent_withdrawal_verify_mismatch',
      entity: 'AgentWithdrawal',
      entityId: record.id,
      details: `MANUAL REVIEW: Paystack's answer for ${record.ref} (${status}) doesn't match this withdrawal's reference, amount or currency. Nothing changed.`,
      actorType: 'superadmin',
      actorName: decidedBy,
    })
    return NextResponse.json({ error: 'Paystack’s record doesn’t match this withdrawal’s reference, amount or currency. Nothing has changed. This needs a manual check.' }, { status: 409 })
  }

  const transferCode = typeof raw?.transfer_code === 'string' ? raw.transfer_code : record.paystackTransferCode
  // decidedAt too: if this was released and approved again while we waited, this answer is out of date.
  const claim = { id, status: record.status, decidedAt: record.decidedAt }
  let newStatus = record.status

  if (NO_MONEY_LEFT.includes(status)) {
    if (!inFlight) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    // Conditional, so a refund happens at most once however many times this is hit.
    const refunded = await prisma.$transaction(async (tx) => {
      // notify: withdrawalDeclined
      const claimed = await tx.agentWithdrawal.updateMany({
        where: claim,
        data: { status: 'Rejected', bankTransferStatus: status, decidedAt: new Date(), decidedBy, adminNote: `Auto-refund: Paystack ${status}` },
      })
      if (claimed.count === 0) return false
      await notify(tx, notifications.withdrawalDeclined({ id, agentId: record.agentId, amount: record.amount, reason: 'The bank transfer didn’t go through.' }))
      await tx.agent.update({ where: { id: record.agentId }, data: { commissionBalance: { increment: record.amount } } })
      return true
    })
    if (!refunded) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    newStatus = 'Rejected'
  } else if (status === 'not_found') {
    // No transfer exists and the commission is still held, so it goes back to the admin to approve again or reject.
    // notify: none — no transfer exists, so it goes back to staff to pay again; the agent's outcome is still to come
    const released = await prisma.agentWithdrawal.updateMany({ where: claim, data: { status: 'Pending', decidedAt: null, decidedBy: null } })
    if (released.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    newStatus = 'Pending'
  } else if (status === 'success' && inFlight) {
    const paid = await prisma.$transaction(async tx => {
      // notify: withdrawalPaid
      const p = await tx.agentWithdrawal.updateMany({
        where: claim,
        data: { status: 'Approved', bankTransferStatus: status, paystackTransferCode: transferCode, ...(record.decidedAt ? {} : { decidedAt: new Date(), decidedBy }) },
      })
      if (p.count === 1) await notify(tx, notifications.withdrawalPaid({ id, agentId: record.agentId, amount: record.amount }))
      return p
    })
    if (paid.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    newStatus = 'Approved'
  } else if (status === 'otp' && transferCode && record.status === 'Processing') {
    // Never from Finalizing: a code may already have gone in, and going back would allow another try.
    // notify: none — internal step, Paystack now wants the staff member's code
    const moved = await prisma.agentWithdrawal.updateMany({ where: claim, data: { status: 'AwaitingOTP', bankTransferStatus: status, paystackTransferCode: transferCode } })
    if (moved.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    newStatus = 'AwaitingOTP'
  } else {
    // Pending, blocked, rejected, otp we can't or mustn't act on, or a status we don't recognise: not paid and not
    // refunded. It stays where it is, with what Paystack said.
    // notify: none — only records Paystack's latest answer for staff; nothing changed for the agent
    await prisma.agentWithdrawal.updateMany({ where: claim, data: { bankTransferStatus: status } })
  }

  logAudit({
    action: 'agent_withdrawal_verify',
    entity: 'AgentWithdrawal',
    entityId: record.id,
    details: `${decidedBy} verified ${record.ref}: Paystack=${status}, internal=${newStatus}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, status: newStatus, bankTransferStatus: status === 'not_found' ? null : status, raw })
}
