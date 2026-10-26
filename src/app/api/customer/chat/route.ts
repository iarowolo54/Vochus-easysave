import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const messages = await prisma.customerChatMessage.findMany({
    where: { customerId: session.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  await prisma.customerChatMessage.updateMany({
    where: { customerId: session.id, sender: { not: 'customer' }, read: false },
    data: { read: true },
  })

  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, imageUrl } = await req.json()
  if (!message?.trim() && !imageUrl) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  const msg = await prisma.customerChatMessage.create({
    data: {
      customerId: session.id,
      sender: 'customer',
      senderId: session.id,
      senderName: session.name,
      message: message?.trim() ?? '',
      ...(imageUrl ? { imageUrl } : {}),
    },
  })

  return NextResponse.json({ message: msg })
}
