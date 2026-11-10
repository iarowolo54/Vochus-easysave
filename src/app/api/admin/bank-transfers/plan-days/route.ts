import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { liveSlots } from '@/lib/bulk-savings'
import { isEligiblePlan, perSlotAmount, readableKey } from '@/lib/catchup'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// The unpaid days a held payment can be credited for: missed ones and today, newest first.
export async function GET(req: NextRequest) {
  const guard = await requirePermission('bank-transfers', 'manage')
  if (!guard.ok) return guard.response

  const planId = req.nextUrl.searchParams.get('planId') ?? ''
  if (!planId) return NextResponse.json({ error: 'Missing plan.' }, { status: 400 })
  const plan = await prisma.savingsPlan.findUnique({ where: { id: planId } })
  if (!plan) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 })

  const now = new Date()
  // Same plans Bulk Savings accepts. The others have no days to choose, so the credit works as it always has.
  if (!isEligiblePlan(plan) || plan.maturityDate.getTime() <= now.getTime()) return NextResponse.json({ days: [], perSlot: 0, weekly: false })

  const weekly = plan.cadence === 'weekly'
  const slots = await liveSlots(prisma, plan, now)
  const days = slots
    .filter((s) => s.state === 'missed' || s.state === 'today')
    .reverse()
    .map((s) => ({
      key: s.key,
      label: s.state === 'today' ? (weekly ? 'This week' : 'Today') : weekly ? `Week ${s.index} · ${readableKey(s.key)}` : readableKey(s.key),
    }))
  return NextResponse.json({ days, perSlot: perSlotAmount(plan), weekly })
}
