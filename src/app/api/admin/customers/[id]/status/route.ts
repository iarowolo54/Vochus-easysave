import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const { status } = await req.json().catch(() => ({}))
  if (status !== 'Active' && status !== 'Locked') {
    return NextResponse.json({ error: 'status must be Active or Locked' }, { status: 400 })
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: { status },
    select: { id: true, customerId: true, firstName: true, lastName: true, status: true },
  })

  logAudit({
    action: status === 'Locked' ? 'customer_lock' : 'customer_unlock',
    entity: 'Customer',
    entityId: customer.id,
    details: `${status === 'Locked' ? 'Locked' : 'Unlocked'} customer ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ ok: true, customer })
}
