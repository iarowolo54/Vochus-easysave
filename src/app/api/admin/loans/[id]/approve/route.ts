import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requirePermission('loans')
  if (!guard.ok) return guard.response
  const session = guard.session

  const adminName = (session.user as any).name ?? 'Super Admin'

  // Conditional claim: only a Pending loan can be decided (guards stale tabs / two admins).
  const claimed = await prisma.loan.updateMany({
    where: { id, status: 'Pending' },
    data: { status: 'Approved', approvedBy: adminName },
  })
  if (claimed.count === 0) {
    const exists = await prisma.loan.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
    return NextResponse.json({ error: 'This loan was already decided' }, { status: 409 })
  }

  const loan = await prisma.loan.findUniqueOrThrow({
    where: { id },
    include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
  })

  logAudit({
    action: 'loan_approve',
    entity: 'Loan',
    entityId: loan.id,
    details: `Loan ${loan.ref} ₦${loan.principal} approved for ${loan.customer.firstName} ${loan.customer.lastName} (${loan.customer.customerId})`,
    actorType: 'admin',
    ...adminActor(session),
  })

  return NextResponse.json({ loan })
}
