import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import {
  appendSavingsRate,
  getCurrentSavingsRate,
  getSavingsRateSchedule,
} from '@/lib/savings-interest-rate'

async function snapshot() {
  const [current, schedule] = await Promise.all([
    getCurrentSavingsRate(prisma),
    getSavingsRateSchedule(prisma),
  ])
  return {
    current,
    history: schedule.map((e) => ({ effectiveFrom: e.effectiveFrom.toISOString(), annualRate: e.annualRate })),
  }
}

export async function GET() {
  const guard = await requirePermission('savings', 'view')
  if (!guard.ok) return guard.response
  return NextResponse.json(await snapshot())
}

// Forward-only: appends a new effective-now entry; past accrual is never restated.
export async function POST(req: NextRequest) {
  const guard = await requirePermission('savings', 'manage')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const annualRate = (body as { annualRate?: unknown } | null)?.annualRate
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < 0 || annualRate > 100) {
    return NextResponse.json({ error: 'annualRate must be a number between 0 and 100' }, { status: 400 })
  }

  const user = guard.session.user as { id?: string; name?: string | null }
  const actorId = guard.actor.id ?? 'unknown'
  await appendSavingsRate(prisma, annualRate, actorId)

  logAudit({
    action: 'savings_interest_rate_updated',
    entity: 'SavingsInterestRate',
    details: `Savings interest rate set to ${annualRate}% per year (effective now)`,
    actorType: guard.actor.type,
    actorId,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, ...(await snapshot()) })
}
