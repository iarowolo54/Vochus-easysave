import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET() {
  const guard = await requirePermission('customers')
  if (!guard.ok) return guard.response
  const session = guard.session
  const rates = await prisma.interestRate.findMany({ orderBy: { durationDays: 'asc' } })
  return NextResponse.json({ rates })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('customers')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { rates } = await req.json()
  if (!Array.isArray(rates)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  type RateInput = { durationDays: number; rate: number; label?: string; maxAmount?: number | null; enabled?: boolean }
  for (const r of rates as RateInput[]) {
    if (typeof r.rate !== 'number' || !isFinite(r.rate) || r.rate < 0 || r.rate > 100) {
      return NextResponse.json({ error: 'Interest rate must be between 0 and 100' }, { status: 400 })
    }
    if (!Number.isInteger(r.durationDays) || r.durationDays <= 0) {
      return NextResponse.json({ error: 'Invalid durationDays' }, { status: 400 })
    }
    if (r.maxAmount != null && (typeof r.maxAmount !== 'number' || !isFinite(r.maxAmount) || r.maxAmount < 0)) {
      return NextResponse.json({ error: 'maxAmount must be a finite number >= 0' }, { status: 400 })
    }
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }
  }

  await prisma.$transaction(
    (rates as RateInput[]).map((r) => {
      const maxAmount = r.maxAmount ?? null
      const enabled = r.enabled ?? true
      return prisma.interestRate.upsert({
        where: { durationDays: r.durationDays },
        update: {
          rate: r.rate,
          maxAmount,
          enabled,
          ...(typeof r.label === 'string' && r.label.trim() ? { label: r.label.trim() } : {}),
        },
        create: {
          durationDays: r.durationDays,
          label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : `${r.durationDays} days`,
          rate: r.rate,
          maxAmount,
          enabled,
        },
      })
    })
  )

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'interest_rates_updated',
    entity: 'InterestRate',
    details: `Updated ${rates.length} interest rate(s): ${rates.map((r: { durationDays: number; rate: number }) => `${r.durationDays}d→${r.rate}%`).join(', ')}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
