import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pictureForRecipient, pictureResponse } from '@/lib/announcement-images'

/** A picture on a pop-up message for agents. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const picture = await pictureForRecipient(prisma, id, 'agent')
  if (!picture) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return pictureResponse(picture)
}
