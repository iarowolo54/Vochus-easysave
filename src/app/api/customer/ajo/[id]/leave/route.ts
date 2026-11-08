import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

/** Leave a group before it starts. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const left = await prisma.$transaction(async tx => {
    if (!(await tx.ajoGroup.count({ where: { id, status: 'Forming' } }))) return -1
    return (await tx.ajoMember.deleteMany({ where: { groupId: id, customerId: session.id } })).count
  })
  if (left === -1) {
    const member = await prisma.ajoMember.count({ where: { groupId: id, customerId: session.id } })
    return member
      ? NextResponse.json({ error: 'This group has started, so you can’t leave it now. Talk to your agent.' }, { status: 409 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (left === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  logAudit({ action: 'ajo_member_left', entity: 'AjoGroup', entityId: id, details: 'A member left an Ajo group before it started', actorType: 'customer', actorId: session.id })
  return NextResponse.json({ ok: true })
}
