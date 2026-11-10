import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { pictureForRecipient, pictureResponse } from '@/lib/announcement-images'

/** A picture on a pop-up message for customers. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const picture = await pictureForRecipient(prisma, id, 'customer')
  if (!picture) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return pictureResponse(picture)
}
