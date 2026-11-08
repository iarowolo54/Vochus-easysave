import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { loadGroup, memberView } from '@/lib/ajo-server'

/** One group the customer belongs to. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const g = await loadGroup(prisma, { id, members: { some: { customerId: session.id } } })
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ group: memberView(g, session.id) }, { headers: { 'Cache-Control': 'no-store' } })
}
