import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildReceiptMessage } from '@/lib/receipt-message'

const MAX_IDS = 90

function parseIds(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS) return null
  if (!ids.every(id => typeof id === 'string' && id)) return null
  return new Set(ids).size === ids.length ? (ids as string[]) : null
}

// Everything in the message comes from the database; the request only says which receipt.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true, name: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const ids = parseIds(await req.json().catch(() => null))
  if (!ids) return NextResponse.json({ error: 'Provide 1–90 different transaction ids' }, { status: 400 })

  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids }, agentId: agent.id },
    select: {
      id: true, ref: true, type: true, amount: true, status: true, createdAt: true, customerId: true, planId: true,
      customer: { select: { firstName: true, lastName: true, agentId: true } },
      plan: { select: { goal: true } },
    },
  })
  if (rows.length !== ids.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  // Request order, so "first reference" matches what the agent's screen shows.
  const byId = new Map(rows.map(r => [r.id, r]))
  const txns = ids.map(id => byId.get(id)!)
  const [first] = txns

  const { customerId, customer } = first
  if (!customerId || !customer) return NextResponse.json({ error: 'This transaction has no customer' }, { status: 400 })
  if (txns.some(t => t.customerId !== customerId)) return NextResponse.json({ error: 'These transactions are for different customers' }, { status: 400 })
  // Same rule as the agent chat: only message your own customers.
  if (customer.agentId !== agent.id) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // A combined total is only true for one savings payment.
  if (txns.length > 1 && txns.some(t => t.type !== 'saving' || t.status !== first.status || t.planId !== first.planId)) {
    return NextResponse.json({ error: 'These transactions are not one savings payment' }, { status: 400 })
  }

  const message = buildReceiptMessage(
    txns.map(t => ({ ref: t.ref, type: t.type, amount: t.amount, status: t.status, createdAt: t.createdAt, planGoal: t.plan?.goal ?? null })),
    { customerName: `${customer.firstName} ${customer.lastName}`, agentName: agent.name },
  )

  await prisma.customerChatMessage.create({
    data: { customerId, sender: 'agent', senderId: agent.id, senderName: agent.name, message },
  })

  return NextResponse.json({ sent: true })
}
