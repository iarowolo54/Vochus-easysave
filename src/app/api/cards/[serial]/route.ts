import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serial } = await params

  const card = await prisma.memberCard.findUnique({
    where: { serial },
    include: {
      customer: {
        select: { firstName: true, lastName: true, customerId: true },
      },
    },
  })

  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  return NextResponse.json({
    id: card.id,
    serial: card.serial,
    status: card.status,
    batchName: card.batchName,
    expiryDate: card.expiryDate,
    customer: card.customer
      ? {
          name: `${card.customer.firstName} ${card.customer.lastName}`,
          customerId: card.customer.customerId,
        }
      : null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serial } = await params
  const body = await req.json()
  const { customerId } = body as { customerId: string }

  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

  const card = await prisma.memberCard.findUnique({ where: { serial } })
  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })
  if (card.status === 'Linked') return NextResponse.json({ error: 'Card already linked' }, { status: 409 })

  const agent = await prisma.agent.findFirst({
    where: { agentId: (session.user as any).agentId },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // The customer being linked must belong to the acting agent — otherwise any
  // agent could link a card to another agent's customer (IDOR).
  const owned = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const updated = await prisma.memberCard.update({
    where: { serial },
    data: {
      customerId,
      agentId: agent.id,
      status: 'Linked',
      linkedAt: new Date(),
    },
    include: {
      customer: { select: { firstName: true, lastName: true, customerId: true } },
    },
  })

  logAudit({
    action: 'card_link',
    entity: 'MemberCard',
    entityId: updated.id,
    details: `Linked card ${updated.serial} to ${updated.customer?.firstName} ${updated.customer?.lastName} (${updated.customer?.customerId})`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({
    id: updated.id,
    serial: updated.serial,
    status: updated.status,
    customer: updated.customer
      ? {
          name: `${updated.customer.firstName} ${updated.customer.lastName}`,
          customerId: updated.customer.customerId,
        }
      : null,
  })
}
