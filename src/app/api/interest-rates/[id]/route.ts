import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Editing the interest-rate table drives loan economics (the rate is now
// server-authoritative — see loans POST), so it must be superadmin-only. This
// route is NOT under /api/admin, so the proxy middleware does not gate it; we
// enforce the role here directly.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json()
  const { rate, label } = body
  const parsedRate = parseFloat(rate)
  if (!isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
    return NextResponse.json({ error: 'Rate must be between 0 and 100' }, { status: 400 })
  }

  const updated = await prisma.interestRate.update({
    where: { id },
    data: { rate: parsedRate, ...(label ? { label } : {}) },
  })

  logAudit({
    action: 'interest_rate_updated',
    entity: 'InterestRate',
    entityId: updated.id,
    details: `Interest rate for ${updated.durationDays} days set to ${updated.rate}% (${updated.label})`,
    actorType: 'admin',
    actorId: (session.user as { id?: string }).id,
    actorName: (session.user as { name?: string }).name ?? 'Super Admin',
  })

  return NextResponse.json({ rate: updated })
}
