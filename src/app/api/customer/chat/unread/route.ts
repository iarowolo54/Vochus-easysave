import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { partyUnreadCount } from '@/lib/support-chat'

export const dynamic = 'force-dynamic'

// How many messages from the agent or the office this customer hasn't opened. Read-only on purpose: the chat's own
// GET marks messages read, so it can't be used for a badge. Counts only the signed-in customer's own threads:
// `agent` is the chat with their agent, `support` the private chat with Vochus Support, `count` both together.
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [agent, support] = await Promise.all([
    prisma.customerChatMessage.count({ where: { customerId: session.id, sender: { not: 'customer' }, read: false } }),
    partyUnreadCount(prisma, { type: 'customer', id: session.id }),
  ])

  return NextResponse.json({ count: agent + support, agent, support }, { headers: { 'Cache-Control': 'no-store' } })
}
