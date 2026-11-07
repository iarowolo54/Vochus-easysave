// Reading in-app notifications for one person. The recipient always comes from the caller's session, never the request.
import type { PrismaClient } from '@prisma/client'
import type { RecipientType } from '@/lib/notifications'

export const FEED_LIMIT = 50
export const FEED_DAYS = 90
/** Someone who has never opened the list only sees the last week as new, not "9+" of history. */
export const FIRST_VISIT_DAYS = 7
const DAY = 86_400_000

type Client = Pick<PrismaClient, 'notification'>

export function newSince(seenAt: Date | null, now: Date): Date {
  return seenAt ?? new Date(now.getTime() - FIRST_VISIT_DAYS * DAY)
}

export async function countNew(client: Client, type: RecipientType, id: string, seenAt: Date | null, now: Date = new Date()): Promise<number> {
  return client.notification.count({ where: { recipientType: type, recipientId: id, createdAt: { gt: newSince(seenAt, now) } } })
}

export interface FeedItem { id: string; kind: string; title: string; body: string | null; href: string | null; at: string; isNew: boolean }

export async function loadFeed(client: Client, type: RecipientType, id: string, seenAt: Date | null, now: Date = new Date()): Promise<{ items: FeedItem[]; newCount: number }> {
  const rows = await client.notification.findMany({
    where: { recipientType: type, recipientId: id, createdAt: { gte: new Date(now.getTime() - FEED_DAYS * DAY) } },
    orderBy: { createdAt: 'desc' },
    take: FEED_LIMIT,
    select: { id: true, kind: true, title: true, body: true, href: true, createdAt: true },
  })
  const since = newSince(seenAt, now).getTime()
  const items = rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, at: r.createdAt.toISOString(), isNew: r.createdAt.getTime() > since }))
  return { items, newCount: items.filter(i => i.isNew).length }
}
