import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

/** Customer photos taken by agents, waiting first. Never the photo itself: a list of base64 images would run to MB. */
export async function GET() {
  const guard = await requirePermission('customer-requests', 'view')
  if (!guard.ok) return guard.response
  const rows = await prisma.customerPhotoRequest.findMany({
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    take: 100,
    select: {
      id: true, status: true, rejectReason: true, submittedAt: true, decidedAt: true, decidedBy: true,
      customer: { select: { id: true, firstName: true, lastName: true, customerId: true } },
      agent: { select: { name: true, agentId: true } },
    },
  })
  // 'Pending' sorts after 'Approved' alphabetically, so put waiting ones first here.
  const ordered = [...rows.filter(r => r.status === 'Pending'), ...rows.filter(r => r.status !== 'Pending')]
  return NextResponse.json({ photos: ordered }, { headers: { 'Cache-Control': 'no-store' } })
}
