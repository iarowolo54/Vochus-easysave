import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { currentAnnouncements, dismissAnnouncement } from '@/lib/announcements'

/** The pop-up messages to show this customer now, oldest first. */
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ announcements: await currentAnnouncements(prisma, 'customer') }, { headers: { 'Cache-Control': 'no-store' } })
}

/** The customer closed it: count them once. It still shows next time. */
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const announcementId = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined
  if (typeof announcementId !== 'string' || !announcementId) return NextResponse.json({ error: 'Missing message' }, { status: 400 })
  if (!(await dismissAnnouncement(prisma, 'customer', session.id, announcementId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
