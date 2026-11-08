import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { loadGroup, memberView } from '@/lib/ajo-server'

/** The customer's Ajo groups (not cancelled), with what they need to know at a glance. */
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ids = await prisma.ajoMember.findMany({ where: { customerId: session.id, group: { status: { not: 'Cancelled' } } }, select: { groupId: true }, orderBy: { joinedAt: 'desc' } })
  const groups = []
  for (const { groupId } of ids) {
    const g = await loadGroup(prisma, { id: groupId })
    if (g) groups.push(memberView(g, session.id))
  }
  return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } })
}
