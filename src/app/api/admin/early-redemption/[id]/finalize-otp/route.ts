import { completionCredits } from '@/lib/commission-ledger'
import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer, PaystackRejected } from '@/lib/paystack'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'
import { BALANCE_CHANGED_AWAITING_OTP, NO_MONEY_LEFT, readyToFinalize, reopenPlanAfterNoTransfer, settlePlanAfterPayout } from '@/lib/redemption-balance'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('redemptions', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const { otp } = await req.json()
  if (!otp) return NextResponse.json({ error: 'OTP required' }, { status: 400 })

  const record = await prisma.earlyRedemption.findUnique({
    where: { id },
    include: {
      savingsPlan: {
        include: { customer: { select: { agentId: true, id: true, firstName: true, lastName: true } } },
      },
    },
  })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.status !== 'AwaitingOTP') return NextResponse.json({ error: 'Already processed' }, { status: 409 })
  if (!record.paystackTransferCode) return NextResponse.json({ error: 'Missing Paystack transfer code on record' }, { status: 400 })

  // Last point before money moves: refuse if a deposit landed after the pre-claim, while waiting for the code.
  if (!readyToFinalize(record.savingsPlan, record.balance)) {
    return NextResponse.json({ error: BALANCE_CHANGED_AWAITING_OTP }, { status: 409 })
  }

  // Claim BEFORE Paystack: AwaitingOTP -> Finalizing. A concurrent submit claims nothing and never finalizes.
  const claim = await prisma.earlyRedemption.updateMany({
    where: { id, status: 'AwaitingOTP' },
    data: { status: 'Finalizing' },
  })
  if (claim.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  let finalStatus: string
  try {
    const r = await finalizeTransfer(record.paystackTransferCode, String(otp))
    finalStatus = r.status
  } catch (err: unknown) {
    if (err instanceof PaystackRejected) {
      // Definite rejection (e.g. wrong OTP): nothing was sent, so hand the claim back for a retry.
      try {
        await prisma.earlyRedemption.updateMany({ where: { id, status: 'Finalizing' }, data: { status: 'AwaitingOTP' } })
      } catch (relErr) {
        console.error('early-redemption finalize-otp: claim release failed', id, relErr instanceof Error ? relErr.name : 'unknown')
      }
      return NextResponse.json({ error: `Paystack rejected the OTP: ${err.message}` }, { status: 400 })
    }
    // Timeout / network / unknown: Paystack may have accepted the finalize. Do NOT release the claim.
    console.error('early-redemption finalize-otp: outcome unknown, left Finalizing', id, err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Could not confirm the Paystack finalisation. Don’t retry. Use Check with Paystack on this request.' }, { status: 502 })
  }

  // Only an explicit success is booked as paid, here and in verify; see TRANSFER_ACCEPTED for why approve still books pending.
  const finalizedBy = (session.user as { name?: string }).name ?? 'Super Admin'
  if (NO_MONEY_LEFT.includes(finalStatus)) {
    await prisma.$transaction(async (tx) => {
      const rel = await tx.earlyRedemption.updateMany({
        where: { id, status: 'Finalizing' },
        data: { status: 'AgentApproved', bankTransferStatus: finalStatus, decidedAt: null, paystackTransferCode: null },
      })
      if (rel.count === 1) await reopenPlanAfterNoTransfer(tx, record.savingsPlanId, record.balance, 'Active')
    })
    logAudit({
      action: 'early_redemption_otp_no_money',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `${finalizedBy} entered the OTP for ${record.ref}: Paystack ${finalStatus}. Nothing paid; ₦${record.balance.toLocaleString()} put back on the plan.`,
      actorType: 'admin',
      actorId: (session.user as { id?: string }).id,
      actorName: finalizedBy,
    })
    return NextResponse.json({ error: `Paystack says this transfer ${finalStatus === 'reversed' ? 'was reversed' : 'failed'}. Nothing was paid, and the money is back on the plan.` }, { status: 502 })
  }
  if (finalStatus !== 'success') {
    await prisma.earlyRedemption.updateMany({ where: { id, status: 'Finalizing' }, data: { bankTransferStatus: finalStatus } })
    logAudit({
      action: 'early_redemption_otp_unclear',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `${finalizedBy} entered the OTP for ${record.ref}: Paystack said "${finalStatus}". Not booked as paid; left Finalizing for Check with Paystack.`,
      actorType: 'admin',
      actorId: (session.user as { id?: string }).id,
      actorName: finalizedBy,
    })
    return NextResponse.json({ ok: true, status: 'Finalizing', bankTransferStatus: finalStatus })
  }

  const decidedBy = guard.actor.name
  const agentId = record.savingsPlan.customer.agentId
  const customerId = record.savingsPlan.customer.id

  let reviewNeeded = false

  try {
    await prisma.$transaction(async (tx) => {
      const fin = await tx.earlyRedemption.updateMany({
        where: { id, status: 'Finalizing' },
        data: { status: 'Approved', decidedAt: new Date(), decidedBy, bankTransferStatus: finalStatus },
      })
      if (fin.count === 0) throw new Error('Finalizing claim lost')
      // The customer has been paid, so the ledger is written whatever happened.
      reviewNeeded = await settlePlanAfterPayout(tx, record)
      // The same split redemptionCompletionOps books, from the fee rule stored on the request.
      const { agentCredit: agentComm, platformCredit: revenueCredit } = await completionCredits(tx, record, agentId, customerId)
      await tx.platformWallet.upsert({
        where: { type: 'Revenue' },
        update: { balance: { increment: revenueCredit } },
        create: { type: 'Revenue', balance: revenueCredit },
      })
      await tx.agent.update({
        where: { id: agentId },
        data: { commissionBalance: { increment: agentComm } },
      })
      await tx.transaction.create({
        data: {
          ref: record.ref,
          agentId,
          customerId,
          planId: record.savingsPlanId,
          type: 'redemption',
          amount: record.netPayout,
          method: record.payoutMethod ?? 'Bank Transfer',
          status: 'Done',
        },
      })
      for (const op of interestPayoutOps(tx, record, agentId, customerId)) await op
    })
  } catch (err) {
    // Paystack already accepted the finalize; leave the record in Finalizing (never re-finalizable) for reconciliation.
    console.error('early-redemption finalize-otp: post-finalize ledger write failed', id, err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Transfer finalised but the ledger update failed. Verify with Paystack; do not retry.' }, { status: 502 })
  }

  logAudit({
    action: 'early_redemption_otp_finalized',
    entity: 'EarlyRedemption',
    entityId: id,
    details: `Admin finalized OTP for redemption ${record.ref} — bank transfer status: ${finalStatus}, payout ₦${record.netPayout.toLocaleString()}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: finalStatus, reviewNeeded })
}
