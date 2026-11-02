import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer, PaystackRejected } from '@/lib/paystack'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'
import { BALANCE_CHANGED_AWAITING_OTP, closePlanAfterFinalize, readyToFinalize } from '@/lib/redemption-balance'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
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
    return NextResponse.json({ error: 'Could not confirm the Paystack finalisation. It is being verified; do not retry. Contact support.' }, { status: 502 })
  }

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'
  const agentId = record.savingsPlan.customer.agentId
  const customerId = record.savingsPlan.customer.id

  // The split stored on the request, same as redemptionCompletionOps; working it out again here can disagree.
  const agentComm = money(record.penalty * (3 / 5))
  const revenueCredit = money(record.penalty * (2 / 5))
  let reviewNeeded = false

  try {
    await prisma.$transaction(async (tx) => {
      const fin = await tx.earlyRedemption.updateMany({
        where: { id, status: 'Finalizing' },
        data: { status: 'Approved', decidedAt: new Date(), decidedBy, bankTransferStatus: finalStatus },
      })
      if (fin.count === 0) throw new Error('Finalizing claim lost')
      // The customer has been paid, so the ledger is written whatever happened. A deposit that landed in
      // this gap stays on the plan, in the same transaction as a flag for someone to sort it out.
      if (!(await closePlanAfterFinalize(tx, record.savingsPlanId, record.balance))) {
        reviewNeeded = true
        // A closed plan's balance is all new money. An open plan (no pre-claim) still holds what was just paid.
        const current = await tx.savingsPlan.findUniqueOrThrow({ where: { id: record.savingsPlanId }, select: { status: true, balance: true } })
        const deposit = current.status === 'Redeemed' ? current.balance : Math.max(0, money(current.balance - record.balance))
        await tx.savingsPlan.update({ where: { id: record.savingsPlanId }, data: { status: 'Redeemed', balance: deposit } })
        await tx.auditLog.create({
          data: {
            action: 'early_redemption_review_needed',
            entity: 'EarlyRedemption',
            entityId: id,
            details: `MANUAL REVIEW: ${record.ref} was paid by Paystack, but plan ${record.savingsPlanId} holds ₦${deposit.toLocaleString()} that arrived during the payout. It was left on the closed plan.`,
            actorType: 'system',
            actorName: 'Finalize OTP',
          },
        })
      }
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
    actorType: 'admin',
    actorId: (session.user as any).id,
    actorName: decidedBy,
  })

  return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: finalStatus, reviewNeeded })
}
