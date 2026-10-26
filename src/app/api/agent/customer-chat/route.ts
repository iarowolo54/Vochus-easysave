import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')

  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const messages = await prisma.customerChatMessage.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    await prisma.customerChatMessage.updateMany({
      where: { customerId, sender: 'customer', read: false },
      data: { read: true },
    })
    return NextResponse.json({ messages })
  }

  const customers = await prisma.customer.findMany({
    where: { agentId: agent.id },
    select: { id: true, customerId: true, firstName: true, lastName: true, photoUrl: true },
  })

  const withUnread = await Promise.all(customers.map(async c => {
    const unread = await prisma.customerChatMessage.count({
      where: { customerId: c.id, sender: 'customer', read: false },
    })
    const last = await prisma.customerChatMessage.findFirst({
      where: { customerId: c.id },
      orderBy: { createdAt: 'desc' },
    })
    return { ...c, unread, lastMessage: last?.imageUrl ? '📷 Image' : last?.message, lastAt: last?.createdAt }
  }))

  return NextResponse.json({ customers: withUnread.filter(c => c.lastAt) })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { customerId, message, imageUrl } = await req.json()
  if (!customerId || (!message?.trim() && !imageUrl)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const msg = await prisma.customerChatMessage.create({
    data: {
      customerId,
      sender: 'agent',
      senderId: agent.id,
      senderName: agent.name,
      message: message?.trim() ?? '',
      ...(imageUrl ? { imageUrl } : {}),
    },
  })

  return NextResponse.json({ message: msg })
}
