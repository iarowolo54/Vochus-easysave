import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await prisma.customerPhotoRequest.findUnique({
    where: { id },
    select: {
      id: true, status: true, photoUrl: true, rejectReason: true, submittedAt: true, decidedAt: true, decidedBy: true,
      customer: { select: { id: true, firstName: true, lastName: true, customerId: true, phone: true, type: true, photoUrl: true } },
      agent: { select: { name: true, agentId: true } },
    },
  })
  if (!r) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  const { photoUrl: current, ...customer } = r.customer
  return NextResponse.json({ ...r, customer, currentPhotoHref: current ? `/api/admin/customers/${customer.id}/photo` : null }, { headers: { 'Cache-Control': 'no-store' } })
}
