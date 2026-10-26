import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session
  const rates = await prisma.interestRate.findMany({ orderBy: { durationDays: 'asc' } })
  return NextResponse.json({ rates })
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { rates } = await req.json()
  if (!Array.isArray(rates)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  for (const r of rates as Array<{ durationDays: number; rate: number; maxAmount?: number }>) {
    if (typeof r.rate !== 'number' || !isFinite(r.rate) || r.rate < 0 || r.rate > 100) {
      return NextResponse.json({ error: 'Interest rate must be between 0 and 100' }, { status: 400 })
    }
  }

  await Promise.all(
    rates.map((r: { durationDays: number; rate: number; maxAmount?: number }) =>
      prisma.interestRate.update({
        where: { durationDays: r.durationDays },
        data: { rate: r.rate },
      })
    )
  )

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'interest_rates_updated',
    entity: 'InterestRate',
    details: `Updated ${rates.length} interest rate(s): ${rates.map((r: { durationDays: number; rate: number }) => `${r.durationDays}d→${r.rate}%`).join(', ')}`,
    actorType: 'admin',
    actorId: (adminUser as any).id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ ok: true })
}
