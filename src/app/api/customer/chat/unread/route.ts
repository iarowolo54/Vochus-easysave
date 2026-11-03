import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// How many messages from the agent or the office this customer hasn't opened. Read-only on purpose: the chat's own
// GET marks messages read, so it can't be used for a badge. Counts only the signed-in customer's own thread.
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = await prisma.customerChatMessage.count({
    where: { customerId: session.id, sender: { not: 'customer' }, read: false },
  })

  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
}
