import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer } from '@/lib/paystack'
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
  if (record.status !== 'AwaitingOTP') return NextResponse.json({ error: `Redemption is in ${record.status} state, not AwaitingOTP` }, { status: 400 })
  if (!record.paystackTransferCode) return NextResponse.json({ error: 'Missing Paystack transfer code on record' }, { status: 400 })

  let finalStatus: string
  try {
    const r = await finalizeTransfer(record.paystackTransferCode, String(otp))
    finalStatus = r.status
  } catch (err: any) {
    return NextResponse.json({ error: `Paystack OTP finalisation failed: ${err.message}` }, { status: 502 })
  }

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'
  const agentId = record.savingsPlan.customer.agentId
  const customerId = record.savingsPlan.customer.id

  const hasCashDeposit = await planHasCashDeposit(prisma, record.savingsPlanId)
  const rates = redemptionDeduction({ balance: record.balance, dailyAmount: record.savingsPlan.dailyAmount, cadence: record.savingsPlan.cadence, hasCashDeposit, source: (record.savingsPlan as any).source })
  const platformFee = money(rates.platform)
  const agentComm = money(rates.agent)
  const revenueCredit = money(platformFee)

  await prisma.$transaction([
    prisma.earlyRedemption.update({
      where: { id },
      data: {
        status: 'Approved',
        decidedAt: new Date(),
        decidedBy,
        bankTransferStatus: finalStatus,
      },
    }),
    prisma.savingsPlan.update({
      where: { id: record.savingsPlanId },
      data: { status: 'Redeemed', balance: 0 },
    }),
    prisma.platformWallet.upsert({
      where: { type: 'Revenue' },
      update: { balance: { increment: revenueCredit } },
      create: { type: 'Revenue', balance: revenueCredit },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { commissionBalance: { increment: agentComm } },
    }),
    prisma.transaction.create({
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
    }),
    ...interestPayoutOps(prisma, record, agentId, customerId),
  ])

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
