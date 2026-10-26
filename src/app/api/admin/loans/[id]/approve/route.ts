import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
