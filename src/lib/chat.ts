// Chat query helpers.
//
// #14: a thread must show the LATEST messages, not the first ever. Fetch the
// newest `limit` descending, then reverse to ascending for display.
//
// #15: the agent conversation list used to run 1 + 2N queries (a full
// findMany of every customer incl. base64 photoUrl, then per-customer unread
// count + last message) on a 5s poll. Do it in a few grouped queries over only
// the customers who actually have messages, and return no base64 photo.
import type { Prisma, PrismaClient } from '@prisma/client'

type Client = Pick<PrismaClient, 'customerChatMessage' | 'customer'> | Prisma.TransactionClient

export async function loadChatThread(client: Client, customerId: string, limit = 100) {
  const latest = await client.customerChatMessage.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return latest.reverse()
}

export type ChatListItem = {
  id: string
  customerId: string
  firstName: string
  lastName: string
  unread: number
  lastMessage: string | undefined
  lastAt: Date | null
}

export async function loadAgentChatList(client: Client, agentDbId: string): Promise<ChatListItem[]> {
  // Conversations (this agent's customers that have >= 1 message) + last timestamp.
  const lastPer = await client.customerChatMessage.groupBy({
    by: ['customerId'],
    where: { customer: { agentId: agentDbId } },
    _max: { createdAt: true },
  })
  if (lastPer.length === 0) return []
  const ids = lastPer.map((g) => g.customerId)

  // Unread (customer-sent, unread) counts per conversation.
  const unreadGroups = await client.customerChatMessage.groupBy({
    by: ['customerId'],
    where: { customerId: { in: ids }, sender: 'customer', read: false },
    _count: { _all: true },
  })
  const unreadMap = new Map(unreadGroups.map((g) => [g.customerId, g._count._all]))

  // The actual last-message rows (one query, bounded by #conversations).
  const lastRows = await client.customerChatMessage.findMany({
    where: { OR: lastPer.map((g) => ({ customerId: g.customerId, createdAt: g._max.createdAt as Date })) },
    select: { customerId: true, message: true, imageUrl: true, createdAt: true },
  })
  const lastMap = new Map<string, { message: string; imageUrl: string | null; createdAt: Date }>()
  for (const m of lastRows) {
    const prev = lastMap.get(m.customerId)
    if (!prev || m.createdAt > prev.createdAt) lastMap.set(m.customerId, m)
  }

  // Names only — never the base64 photoUrl.
  const customers = await client.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, customerId: true, firstName: true, lastName: true },
  })

  return customers
    .map((c) => {
      const last = lastMap.get(c.id)
      return {
        id: c.id,
        customerId: c.customerId,
        firstName: c.firstName,
        lastName: c.lastName,
        unread: unreadMap.get(c.id) ?? 0,
        lastMessage: last?.imageUrl ? '📷 Image' : last?.message,
        lastAt: last?.createdAt ?? null,
      }
    })
    .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0))
}
