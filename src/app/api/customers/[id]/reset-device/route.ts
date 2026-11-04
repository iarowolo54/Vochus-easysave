import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { resetCustomerDevice } from '@/lib/reset-device'

// An agent frees one of their own customers from a locked phone (a new or lost phone). Only customers on this agent's own books.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true, name: true, agentId: true, status: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.status !== 'Active') return NextResponse.json({ error: 'Your account is not active' }, { status: 403 })

  const { id } = await params
  const customer = await prisma.customer.findFirst({
    where: { id, agentId: agent.id },
    select: { id: true, firstName: true, lastName: true, customerId: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const revoked = await resetCustomerDevice(prisma, customer.id)

  logAudit({
    action: 'customer_reset_device',
    entity: 'Customer',
    entityId: customer.id,
    details: `Agent ${agent.name} (${agent.agentId}) reset the device for ${customer.firstName} ${customer.lastName} (${customer.customerId}): lock cleared, signed out, ${revoked} fingerprint sign-in${revoked === 1 ? '' : 's'} revoked`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ ok: true })
}
