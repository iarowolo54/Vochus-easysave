import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer, PaystackRejected } from '@/lib/paystack'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'

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

  // Read-only inputs for the credit, computed before the claim.
  const hasCashDeposit = await planHasCashDeposit(prisma, record.savingsPlanId)

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

  const rates = redemptionDeduction({ balance: record.balance, dailyAmount: record.savingsPlan.dailyAmount, cadence: record.savingsPlan.cadence, hasCashDeposit, source: (record.savingsPlan as any).source })
  const platformFee = money(rates.platform)
  const agentComm = money(rates.agent)
  const revenueCredit = money(platformFee)

  try {
    await prisma.$transaction(async (tx) => {
      const fin = await tx.earlyRedemption.updateMany({
        where: { id, status: 'Finalizing' },
        data: { status: 'Approved', decidedAt: new Date(), decidedBy, bankTransferStatus: finalStatus },
      })
      if (fin.count === 0) throw new Error('Finalizing claim lost')
      await tx.savingsPlan.update({
        where: { id: record.savingsPlanId },
        data: { status: 'Redeemed', balance: 0 },
      })
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

  return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: finalStatus })
}
