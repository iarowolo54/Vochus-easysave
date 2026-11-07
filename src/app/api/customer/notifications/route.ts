import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { countNew, loadFeed } from '@/lib/notification-feed'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

/** ?count=1 → { count } for the bell; otherwise { items, newCount }. Only this customer's own notifications. */
export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, notificationsSeenAt: true } })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.nextUrl.searchParams.get('count') === '1') {
    return NextResponse.json({ count: await countNew(prisma, 'customer', me.id, me.notificationsSeenAt) }, NO_STORE)
  }
  return NextResponse.json(await loadFeed(prisma, 'customer', me.id, me.notificationsSeenAt), NO_STORE)
}

/** The list was opened: everything up to now counts as seen, so the bell clears. */
export async function POST() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.customer.update({ where: { id: session.id }, data: { notificationsSeenAt: new Date() } })
  return NextResponse.json({ ok: true })
}
