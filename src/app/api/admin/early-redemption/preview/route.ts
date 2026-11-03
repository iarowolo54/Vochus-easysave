import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/money'
import { collectionFee } from '@/lib/commission-ledger'
import { planHasCashDeposit, redemptionDeduction } from '@/lib/wallet-rates'

// The fee an admin-started collection of this plan would carry, worked out the same way the request does.
export async function GET(req: NextRequest) {
  const guard = await requirePermission('redemptions', 'view')
  if (!guard.ok) return guard.response
  const planId = req.nextUrl.searchParams.get('planId')
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })
  const plan = await prisma.savingsPlan.findUnique({ where: { id: planId } })
  if (!plan) return NextResponse.json({ error: 'Savings plan not found' }, { status: 404 })
  const fee = await collectionFee(prisma, { id: plan.id, cadence: plan.cadence, dailyAmount: plan.dailyAmount, source: plan.source, feeCollected: plan.feeCollected }, plan.balance, new Date())
  const legacy = redemptionDeduction({
    balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence,
    hasCashDeposit: await planHasCashDeposit(prisma, plan.id), periodDays: plan.periodDays, initiator: 'admin', source: plan.source,
  }).total
  const deduction = money(Math.min(fee.feeRule === 'v2' ? fee.penalty : legacy, plan.balance))
  return NextResponse.json({ balance: money(plan.balance), fee: deduction, netPayout: money(plan.balance - deduction) })
}
