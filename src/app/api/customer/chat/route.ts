import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { validatePhoto } from '@/lib/photo'
import { loadChatThread } from '@/lib/chat'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Latest 100 (ascending), not the first 100 ever (#14).
  const messages = await loadChatThread(prisma, session.id, 100)

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
  // Shown as a link and an image to the other side, so it must really be a picture.
  const image = validatePhoto(imageUrl)
  if (!image.ok) return NextResponse.json({ error: image.error }, { status: 400 })

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
