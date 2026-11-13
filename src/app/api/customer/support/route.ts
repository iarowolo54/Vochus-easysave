import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { partySendResponse, partyThreadResponse } from '@/lib/support-party'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

/** The signed-in customer's own chat with Vochus Support. Their agent can't see it. */
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return partyThreadResponse({ type: 'customer', id: session.id }, session.name)
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return partySendResponse({ type: 'customer', id: session.id }, session.name, await req.json().catch(() => null))
}
