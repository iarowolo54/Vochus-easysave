import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionAgent } from '@/lib/ajo-server'
import { latestPhotoRequests } from '@/lib/customer-photo-request'
import { getPhotoDeadline, lastSaveDay, photoPhase, photoStatusOf } from '@/lib/photo-deadline'

/** The agent's active customers who still need a photo, for the reminder pop-up. Empty before the clock starts. */
export async function GET() {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const deadline = await getPhotoDeadline(prisma)
  const phase = photoPhase(deadline, new Date())
  if (!deadline || phase === 'none') return NextResponse.json({ deadline: null, lastDay: null, phase, customers: [] }, { headers: { 'Cache-Control': 'no-store' } })

  const rows = await prisma.customer.findMany({
    where: { agentId: agent.id, status: 'Active', OR: [{ photoUrl: null }, { photoUrl: '' }] },
    select: { id: true, firstName: true, lastName: true, customerId: true },
    orderBy: { firstName: 'asc' },
  })
  const reqs = await latestPhotoRequests(prisma, rows.map(r => r.id))
  const customers = rows.map(r => {
    const s = photoStatusOf(false, reqs.get(r.id) ?? null)
    return { id: r.id, name: `${r.firstName} ${r.lastName}`, firstName: r.firstName, customerId: r.customerId, photoStatus: s.status, rejectReason: s.rejectReason }
  })
  return NextResponse.json({ deadline: deadline.toISOString(), lastDay: lastSaveDay(deadline), phase, customers }, { headers: { 'Cache-Control': 'no-store' } })
}
