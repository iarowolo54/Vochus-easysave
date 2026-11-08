import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { dismissAnnouncement, nextAnnouncement } from '@/lib/announcements'

/** The pop-up message to show this customer now, if any. */
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ announcement: await nextAnnouncement(prisma, 'customer', session.id) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** The customer tapped OK: don't show it to them again. */
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const announcementId = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined
  if (typeof announcementId !== 'string' || !announcementId) return NextResponse.json({ error: 'Missing message' }, { status: 400 })
  if (!(await dismissAnnouncement(prisma, 'customer', session.id, announcementId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
