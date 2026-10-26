import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const adminName = (session.user as any).name ?? 'Super Admin'

  const loan = await prisma.loan.update({
    where: { id },
    data: { status: 'Approved', approvedBy: adminName },
    include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
  })

  logAudit({
    action: 'loan_approve',
    entity: 'Loan',
    entityId: loan.id,
    details: `Loan ${loan.ref} ₦${loan.principal} approved for ${loan.customer.firstName} ${loan.customer.lastName} (${loan.customer.customerId})`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ loan })
}
