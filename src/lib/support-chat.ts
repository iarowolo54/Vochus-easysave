// Support chat: private conversations between Vochus Support (super admin / staff) and one agent or one customer.
//
// Kept apart from CustomerChatMessage on purpose: a customer's agent can read that thread, and must never read this
// one (a customer may be complaining about their agent). Each agent and each customer has at most one thread.
//
// Rules this module owns:
//  - Agents and customers never name a thread: it is always found from their own session (partyWhere).
//  - The agent or customer only ever sees "Vochus Support" on office replies; the real staff name is stored for the
//    office's own record (partyView strips it).
//  - Messages are append-only. Nothing here edits or deletes one.
//  - An office reply notifies the agent or customer once per burst (startsReplyBurst), inside the same transaction.
//    The nightly safety net rebuilds the same events from the records (supportSweepEvents).
import type { Prisma, PrismaClient } from '@prisma/client'
import { notifications, notify, type NotificationEvent } from '@/lib/notifications'
import { validatePhoto } from '@/lib/photo'

import { MESSAGE_MAX, SUPPORT_NAME } from '@/lib/support-limits'

export { MESSAGE_MAX, SUPPORT_NAME }
export const THREAD_PAGE = 100
/** An office message more than this long after the previous one starts a new burst, so it notifies again. */
export const BURST_GAP_MS = 30 * 60_000

export type PartyType = 'agent' | 'customer'
export type Party = { type: PartyType; id: string }
export type Sender = 'admin' | PartyType

type Client = PrismaClient | Prisma.TransactionClient

// ── Pure helpers ────────────────────────────────────────────────────────────

export type MessageInput = { ok: true; message: string; imageUrl: string | null } | { ok: false; error: string }

/** Narrows an untrusted request body to a message. Text is trimmed; a picture must really be a picture. */
export function parseMessageInput(body: unknown): MessageInput {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const text = typeof b.message === 'string' ? b.message.trim() : ''
  const rawImage = b.imageUrl === undefined || b.imageUrl === null || b.imageUrl === '' ? null : b.imageUrl
  if (!text && !rawImage) return { ok: false, error: 'Write a message or add a picture' }
  if (text.length > MESSAGE_MAX) return { ok: false, error: `Keep a message under ${MESSAGE_MAX.toLocaleString('en-GB')} characters` }
  if (rawImage !== null) {
    const image = validatePhoto(rawImage)
    if (!image.ok) return { ok: false, error: image.error }
  }
  return { ok: true, message: text, imageUrl: typeof rawImage === 'string' ? rawImage : null }
}

/** The where-clause for a party's own thread. Never built from a request body. */
export function partyWhere(party: Party): { agentId: string } | { customerId: string } {
  return party.type === 'agent' ? { agentId: party.id } : { customerId: party.id }
}

/** Who a thread belongs to, or null when the account behind it is gone. */
export function threadParty(t: { agentId: string | null; customerId: string | null }): Party | null {
  if (t.agentId) return { type: 'agent', id: t.agentId }
  if (t.customerId) return { type: 'customer', id: t.customerId }
  return null
}

/** Does this office message start a new burst (and so a notification)? Same answer live and in the safety net. */
export function startsReplyBurst(
  msg: { sender: string; createdAt: Date },
  prev: { sender: string; createdAt: Date } | null,
): boolean {
  if (msg.sender !== 'admin') return false
  if (!prev || prev.sender !== 'admin') return true
  return msg.createdAt.getTime() - prev.createdAt.getTime() > BURST_GAP_MS
}

type StoredMessage = {
  id: string; sender: string; senderId: string | null; senderName: string | null; message: string
  imageUrl: string | null; readByParty: boolean; readByAdmin: boolean; createdAt: Date
}

export type PartyMessage = { id: string; sender: Sender; senderName: string; message: string; imageUrl: string | null; read: boolean; createdAt: Date }

/** What the agent or customer may see: office replies are "Vochus Support", with no staff name or id. */
export function partyView(m: StoredMessage, partyName: string): PartyMessage {
  const fromOffice = m.sender === 'admin'
  return {
    id: m.id,
    sender: m.sender as Sender,
    senderName: fromOffice ? SUPPORT_NAME : partyName,
    message: m.message,
    imageUrl: m.imageUrl,
    // For the party's own messages: has the office read it? For office messages: always true once loaded.
    read: fromOffice ? true : m.readByAdmin,
    createdAt: m.createdAt,
  }
}

export function previewOf(m: { message: string; imageUrl: string | null } | undefined): string | null {
  if (!m) return null
  if (m.message) return m.message.length > 120 ? `${m.message.slice(0, 117)}…` : m.message
  return m.imageUrl ? 'Picture' : null
}

// ── Database ────────────────────────────────────────────────────────────────

const isUniqueClash = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

/** The party's thread, created on first use. Two sends at once can't make two threads (unique + retry). */
export async function getOrCreateThread(client: Client, party: Party) {
  const where = partyWhere(party)
  const found = await client.supportThread.findFirst({ where })
  if (found) return found
  try {
    return await client.supportThread.create({ data: where })
  } catch (e) {
    if (!isUniqueClash(e)) throw e
    const again = await client.supportThread.findFirst({ where })
    if (!again) throw e
    return again
  }
}

/** Latest messages, oldest first. */
export async function loadMessages(client: Client, threadId: string, limit = THREAD_PAGE) {
  const latest = await client.supportMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: limit })
  return latest.reverse()
}

/**
 * Writes one message, moves the thread to the top and reopens it, and notifies the agent or customer when an office
 * message starts a burst. All in one short transaction.
 */
export async function sendSupportMessage(
  prisma: PrismaClient,
  f: { threadId: string; party: Party; sender: Sender; senderId: string | null; senderName: string | null; message: string; imageUrl: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const prev = await tx.supportMessage.findFirst({
      where: { threadId: f.threadId }, orderBy: { createdAt: 'desc' }, select: { sender: true, createdAt: true },
    })
    const msg = await tx.supportMessage.create({
      data: {
        threadId: f.threadId, sender: f.sender, senderId: f.senderId, senderName: f.senderName, message: f.message,
        imageUrl: f.imageUrl,
        // A sender has obviously read their own side.
        readByAdmin: f.sender === 'admin', readByParty: f.sender !== 'admin',
      },
    })
    await tx.supportThread.update({ where: { id: f.threadId }, data: { lastMessageAt: msg.createdAt, status: 'Open' } })
    if (startsReplyBurst(msg, prev)) {
      // notify: supportReply
      await notify(tx, notifications.supportReply({ messageId: msg.id, recipient: f.party }))
    }
    return msg
  })
}

/** Unread office messages for this agent or customer (read-only; for badges). */
export async function partyUnreadCount(client: Client, party: Party): Promise<number> {
  return client.supportMessage.count({ where: { sender: 'admin', readByParty: false, thread: partyWhere(party) } })
}

/** Threads with at least one unread agent/customer message (read-only; for the office badge). */
export async function adminUnreadThreads(client: Client): Promise<number> {
  return client.supportThread.count({ where: { messages: { some: { sender: { not: 'admin' }, readByAdmin: false } } } })
}

/** Where the office app loads a person's photo from (src/app/api/admin/support/photo). */
export const supportPhotoPath = (type: PartyType, id: string) => `/api/admin/support/photo?${type}=${encodeURIComponent(id)}`

/** Which of these people have a photo, without reading the photos (they are large base64 strings). */
export async function idsWithPhoto(client: Client, people: { type: PartyType; id: string }[]): Promise<Set<string>> {
  const agentIds = people.filter((p) => p.type === 'agent').map((p) => p.id)
  const customerIds = people.filter((p) => p.type === 'customer').map((p) => p.id)
  const [a, c] = await Promise.all([
    agentIds.length ? client.agent.findMany({ where: { id: { in: agentIds }, photoUrl: { not: null } }, select: { id: true } }) : [],
    customerIds.length ? client.customer.findMany({ where: { id: { in: customerIds }, photoUrl: { not: null } }, select: { id: true } }) : [],
  ])
  return new Set([...a, ...c].map((r) => r.id))
}

export type ThreadFilter = { type?: PartyType | null; status?: 'Open' | 'Closed' | null; unread?: boolean; q?: string; page: number; pageSize: number }

export type ThreadListItem = {
  id: string; status: string; lastMessageAt: Date; unread: number; preview: string | null; lastFromOffice: boolean
  party: { type: PartyType; id: string; code: string; name: string; status: string; photoUrl: string | null } | null
}

/** The office inbox: newest conversation first. Names and codes only, never a photo or a picture. */
export async function listThreads(client: Client, f: ThreadFilter): Promise<{ threads: ThreadListItem[]; total: number }> {
  const and: Prisma.SupportThreadWhereInput[] = []
  if (f.type === 'agent') and.push({ agentId: { not: null } })
  if (f.type === 'customer') and.push({ customerId: { not: null } })
  if (f.status) and.push({ status: f.status })
  if (f.unread) and.push({ messages: { some: { sender: { not: 'admin' }, readByAdmin: false } } })
  const q = f.q?.trim()
  if (q) {
    const words = q.split(/\s+/).slice(0, 4)
    and.push({
      OR: [
        { agent: { OR: [{ agentId: { contains: q } }, { AND: words.map((w) => ({ name: { contains: w } })) }] } },
        { customer: { OR: [{ customerId: { contains: q } }, { phone: { contains: q } }, { AND: words.map((w) => ({ OR: [{ firstName: { contains: w } }, { lastName: { contains: w } }] })) }] } },
      ],
    })
  }
  const where: Prisma.SupportThreadWhereInput = and.length ? { AND: and } : {}

  const [rows, total] = await Promise.all([
    client.supportThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, status: true, lastMessageAt: true, agentId: true, customerId: true,
        agent: { select: { agentId: true, name: true, status: true } },
        customer: { select: { customerId: true, firstName: true, lastName: true, status: true } },
      },
    }),
    client.supportThread.count({ where }),
  ])
  if (rows.length === 0) return { threads: [], total }
  const ids = rows.map((r) => r.id)

  const [unreadGroups, lastRows] = await Promise.all([
    client.supportMessage.groupBy({
      by: ['threadId'], where: { threadId: { in: ids }, sender: { not: 'admin' }, readByAdmin: false }, _count: { _all: true },
    }),
    client.supportMessage.findMany({
      where: { OR: rows.map((r) => ({ threadId: r.id, createdAt: r.lastMessageAt })) },
      select: { threadId: true, sender: true, message: true, imageUrl: true, createdAt: true },
    }),
  ])
  const withPhoto = await idsWithPhoto(client, rows.flatMap((r): Party[] => {
    const p = threadParty(r)
    return p ? [p] : []
  }))
  const photo = (type: PartyType, id: string) => (withPhoto.has(id) ? supportPhotoPath(type, id) : null)
  const unread = new Map(unreadGroups.map((g) => [g.threadId, g._count._all]))
  const last = new Map<string, (typeof lastRows)[number]>()
  for (const m of lastRows) {
    const p = last.get(m.threadId)
    if (!p || m.createdAt > p.createdAt) last.set(m.threadId, m)
  }

  return {
    total,
    threads: rows.map((r) => {
      const l = last.get(r.id)
      const party: ThreadListItem['party'] = r.agent && r.agentId
        ? { type: 'agent', id: r.agentId, code: r.agent.agentId, name: r.agent.name, status: r.agent.status, photoUrl: photo('agent', r.agentId) }
        : r.customer && r.customerId
          ? { type: 'customer', id: r.customerId, code: r.customer.customerId, name: `${r.customer.firstName} ${r.customer.lastName}`, status: r.customer.status, photoUrl: photo('customer', r.customerId) }
          : null
      return {
        id: r.id, status: r.status, lastMessageAt: r.lastMessageAt, unread: unread.get(r.id) ?? 0,
        preview: previewOf(l), lastFromOffice: l?.sender === 'admin', party,
      }
    }),
  }
}

// ── Nightly safety net ──────────────────────────────────────────────────────

/**
 * The reply notifications the live path should have written for office messages since `since`. Messages from
 * `since - BURST_GAP_MS` are read so each message's predecessor is known; one with none in range is a new burst.
 */
export async function supportSweepEvents(client: Client, since: Date): Promise<NotificationEvent[]> {
  const rows = await client.supportMessage.findMany({
    where: { createdAt: { gte: new Date(since.getTime() - BURST_GAP_MS) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, threadId: true, sender: true, createdAt: true, thread: { select: { agentId: true, customerId: true } } },
  })
  return supportReplyEventsFrom(rows, since)
}

/** Pure part of the safety net, for tests. `rows` must be oldest first. */
export function supportReplyEventsFrom(
  rows: { id: string; threadId: string; sender: string; createdAt: Date; thread: { agentId: string | null; customerId: string | null } }[],
  since: Date,
): NotificationEvent[] {
  const prevOf = new Map<string, { sender: string; createdAt: Date }>()
  const out: NotificationEvent[] = []
  for (const m of rows) {
    const prev = prevOf.get(m.threadId) ?? null
    prevOf.set(m.threadId, m)
    if (m.createdAt.getTime() < since.getTime() || !startsReplyBurst(m, prev)) continue
    const party = threadParty(m.thread)
    if (!party) continue
    out.push(...notifications.supportReply({ messageId: m.id, recipient: party }).map((e) => ({ ...e, at: m.createdAt })))
  }
  return out
}
