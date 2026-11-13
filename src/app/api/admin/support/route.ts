import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { getOrCreateThread, listThreads, parseMessageInput, sendSupportMessage, type Party } from '@/lib/support-chat'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

/** The office inbox. ?type=agent|customer &status=Open|Closed &unread=1 &q= &page= &pageSize= */
export async function GET(req: NextRequest) {
  const guard = await requirePermission('support', 'view')
  if (!guard.ok) return guard.response

  const sp = new URL(req.url).searchParams
  const type = sp.get('type')
  const status = sp.get('status')
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(sp.get('pageSize'))) || 30))
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1)

  const { threads, total } = await listThreads(prisma, {
    type: type === 'agent' || type === 'customer' ? type : null,
    status: status === 'Open' || status === 'Closed' ? status : null,
    unread: sp.get('unread') === '1',
    q: (sp.get('q') ?? '').slice(0, 60),
    page, pageSize,
  })
  return NextResponse.json({ threads, total, page, pageSize }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Start (or continue) a chat with one agent or customer: { agentId | customerId, message, imageUrl? }. Ids are database ids. */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('support', 'manage')
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const agentId = typeof b.agentId === 'string' && b.agentId ? b.agentId : null
  const customerId = typeof b.customerId === 'string' && b.customerId ? b.customerId : null
  if ((agentId ? 1 : 0) + (customerId ? 1 : 0) !== 1) {
    return NextResponse.json({ error: 'Choose one agent or one customer' }, { status: 400 })
  }
  const input = parseMessageInput(body)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

  const exists = agentId
    ? await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
    : await prisma.customer.findUnique({ where: { id: customerId as string }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const party: Party = agentId ? { type: 'agent', id: agentId } : { type: 'customer', id: customerId as string }
  const thread = await getOrCreateThread(prisma, party)
  const message = await sendSupportMessage(prisma, {
    threadId: thread.id, party, sender: 'admin', senderId: guard.actor.id ?? null, senderName: guard.actor.name,
    message: input.message, imageUrl: input.imageUrl,
  })
  return NextResponse.json({ threadId: thread.id, message }, { status: 201 })
}
