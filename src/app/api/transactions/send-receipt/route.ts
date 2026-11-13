import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildReceiptCard, buildReceiptMessage, canSendReceipt, customerCanSignIn, earliestFirst, receiptStatus } from '@/lib/receipt-message'
import { loadPayoutOutcome } from '@/lib/receipt-payout'

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
      id: true, ref: true, type: true, amount: true, method: true, status: true, createdAt: true, customerId: true, planId: true,
      customer: { select: { firstName: true, lastName: true, agentId: true, password: true, status: true, phone: true } },
      plan: { select: { goal: true } },
    },
  })
  if (rows.length !== ids.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const txns = earliestFirst(rows)
  const [first] = txns

  const { customerId, customer } = first
  if (!customerId || !customer) return NextResponse.json({ error: 'This transaction has no customer' }, { status: 400 })
  if (txns.some(t => t.customerId !== customerId)) return NextResponse.json({ error: 'These transactions are for different customers' }, { status: 400 })
  // Same rule as the agent chat: only message your own customers.
  if (customer.agentId !== agent.id) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // There's no batch id, so this can't prove one payment. It only stops a total that adds up unlike rows.
  if (txns.length > 1 && txns.some(t => t.type !== 'saving' || t.status !== first.status || t.planId !== first.planId || t.amount !== first.amount || t.method !== first.method)) {
    return NextResponse.json({ error: 'These transactions are not one savings payment' }, { status: 400 })
  }

  const payout = await loadPayoutOutcome(first)
  if (!canSendReceipt(payout)) {
    return NextResponse.json({ error: `This bank payout ${payout === 'failed' ? 'failed' : 'was reversed'}, so the receipt can’t be sent.` }, { status: 409 })
  }

  const receiptTxns = txns.map(t => ({ ref: t.ref, type: t.type, amount: t.amount, status: t.status, createdAt: t.createdAt, planGoal: t.plan?.goal ?? null, method: t.method, payout }))
  const who = { customerName: `${customer.firstName} ${customer.lastName}`, agentName: agent.name }
  const message = buildReceiptMessage(receiptTxns, who)
  // Drawn as the receipt picture in both chats; the text stays for previews.
  const receipt = JSON.stringify(buildReceiptCard(receiptTxns, who))

  // Together, so a receipt the customer can see always has its audit row.
  await prisma.$transaction(async (tx) => {
    const sent = await tx.customerChatMessage.create({
      data: { customerId, sender: 'agent', senderId: agent.id, senderName: agent.name, message, receipt },
      select: { id: true },
    })
    await tx.auditLog.create({
      data: {
        action: 'receipt_sent_to_chat',
        entity: 'Transaction',
        entityId: first.id,
        details: `status: ${receiptStatus({ status: first.status, payout })} | message: ${sent.id} | ids: ${txns.map(t => t.id).join(', ')} | refs: ${txns.map(t => t.ref).join(', ')}`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
      },
    })
  })

  return NextResponse.json({ sent: true, canOpenChat: customerCanSignIn(customer), hasPhone: !!customer.phone })
}
