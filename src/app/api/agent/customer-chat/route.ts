import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validatePhoto } from '@/lib/photo'
import { loadChatThread, loadAgentChatList } from '@/lib/chat'

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

    // Latest 100 (ascending), not the first 100 ever (#14).
    const messages = await loadChatThread(prisma, customerId, 100)
    await prisma.customerChatMessage.updateMany({
      where: { customerId, sender: 'customer', read: false },
      data: { read: true },
    })
    return NextResponse.json({ messages })
  }

  // Conversation list in a few grouped queries, no base64 photo (#15).
  const customers = await loadAgentChatList(prisma, agent.id)
  return NextResponse.json({ customers })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { customerId, message, imageUrl } = await req.json()
  if (!customerId || (!message?.trim() && !imageUrl)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  // Shown as a link and an image to the other side, so it must really be a picture.
  const image = validatePhoto(imageUrl)
  if (!image.ok) return NextResponse.json({ error: image.error }, { status: 400 })

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
