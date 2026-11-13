import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { loadMessages, parseMessageInput, sendSupportMessage, threadParty } from '@/lib/support-chat'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const partySelect = {
  id: true, status: true, agentId: true, customerId: true,
  agent: { select: { id: true, agentId: true, name: true, phone: true, status: true } },
  customer: {
    select: {
      id: true, customerId: true, firstName: true, lastName: true, phone: true, status: true, type: true,
      agent: { select: { agentId: true, name: true } },
    },
  },
} as const

/** One conversation: who it is with and the latest messages. Opening it marks their messages read by the office. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('support', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params

  const thread = await prisma.supportThread.findUnique({ where: { id }, select: partySelect })
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await loadMessages(prisma, id)
  await prisma.supportMessage.updateMany({ where: { threadId: id, sender: { not: 'admin' }, readByAdmin: false }, data: { readByAdmin: true } })

  const c = thread.customer
  return NextResponse.json({
    thread: {
      id: thread.id,
      status: thread.status,
      party: thread.agent
        ? { type: 'agent', id: thread.agent.id, code: thread.agent.agentId, name: thread.agent.name, phone: thread.agent.phone, status: thread.agent.status }
        : c
          ? {
              type: 'customer', id: c.id, code: c.customerId, name: `${c.firstName} ${c.lastName}`, phone: c.phone, status: c.status,
              customerType: c.type, agentName: c.agent?.name ?? null, agentCode: c.agent?.agentId ?? null,
            }
          : null,
    },
    messages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Reply as Vochus Support. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('support', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params

  const input = parseMessageInput(await req.json().catch(() => null))
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

  const thread = await prisma.supportThread.findUnique({ where: { id }, select: { id: true, agentId: true, customerId: true } })
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const party = threadParty(thread)
  if (!party) return NextResponse.json({ error: 'This account no longer exists' }, { status: 409 })

  const message = await sendSupportMessage(prisma, {
    threadId: id, party, sender: 'admin', senderId: guard.actor.id ?? null, senderName: guard.actor.name,
    message: input.message, imageUrl: input.imageUrl,
  })
  return NextResponse.json({ message }, { status: 201 })
}

/** Close or reopen: { status: 'Open' | 'Closed' }. A new message from either side reopens it anyway. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('support', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params

  const body: unknown = await req.json().catch(() => null)
  const status = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined
  if (status !== 'Open' && status !== 'Closed') return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const { count } = await prisma.supportThread.updateMany({ where: { id, status: { not: status } }, data: { status } })
  if (count === 0) {
    const exists = await prisma.supportThread.findUnique({ where: { id }, select: { status: true } })
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ status: exists.status })
  }

  logAudit({
    action: status === 'Closed' ? 'support_chat_closed' : 'support_chat_reopened',
    entity: 'SupportThread', entityId: id,
    details: `Support chat ${status === 'Closed' ? 'closed' : 'reopened'}`,
    actorType: guard.actor.type, actorId: guard.actor.id, actorName: guard.actor.name,
  })
  return NextResponse.json({ status })
}
