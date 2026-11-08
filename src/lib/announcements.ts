// Pop-up messages from super admin, shown to agents and/or customers when they open the app, once each until they
// tap OK. Title and plain text only (owner's choice, Nov 2026). Dates are Lagos calendar days.
import type { PrismaClient } from '@prisma/client'

export const AUDIENCES = ['agents', 'customers', 'both'] as const
export type Audience = (typeof AUDIENCES)[number]
export type RecipientType = 'agent' | 'customer'

export const TITLE_MAX = 80
export const BODY_MAX = 600

export const AUDIENCE_LABEL: Record<Audience, string> = { agents: 'Agents', customers: 'Customers', both: 'Agents and customers' }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Lagos is UTC+1 all year (no daylight saving). */
const lagosStart = (day: string) => new Date(`${day}T00:00:00+01:00`)
const lagosEnd = (day: string) => new Date(`${day}T23:59:59.999+01:00`)

export type AnnouncementInput = { title: string; body: string; audience: Audience; startsAt: Date; endsAt: Date }

/** Narrow an untrusted body into a message, or say what's wrong (field → message). */
export function parseAnnouncement(raw: unknown): { ok: true; value: AnnouncementInput } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Record<string, string> = {}
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  const audience = b.audience
  const start = typeof b.startDate === 'string' ? b.startDate : ''
  const end = typeof b.endDate === 'string' ? b.endDate : ''

  if (!title) errors.title = 'Enter a title.'
  else if (title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters.`
  if (!body) errors.body = 'Enter the message.'
  else if (body.length > BODY_MAX) errors.body = `Keep the message to ${BODY_MAX} characters.`
  if (!AUDIENCES.includes(audience as Audience)) errors.audience = 'Choose who sees it.'
  if (!DAY_RE.test(start) || Number.isNaN(lagosStart(start).getTime())) errors.startDate = 'Choose a start date.'
  if (!DAY_RE.test(end) || Number.isNaN(lagosEnd(end).getTime())) errors.endDate = 'Choose an end date.'
  else if (!errors.startDate && end < start) errors.endDate = 'The end date can’t be before the start date.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { title, body, audience: audience as Audience, startsAt: lagosStart(start), endsAt: lagosEnd(end) } }
}

/** The audiences that include this kind of person. */
export function audiencesFor(type: RecipientType): Audience[] {
  return type === 'agent' ? ['agents', 'both'] : ['customers', 'both']
}

/** The oldest message showing now that this person hasn't dismissed, or null. */
export async function nextAnnouncement(client: PrismaClient, type: RecipientType, id: string, now: Date = new Date()) {
  return client.announcement.findFirst({
    where: {
      isActive: true, startsAt: { lte: now }, endsAt: { gte: now }, audience: { in: audiencesFor(type) },
      dismissals: { none: { recipientType: type, recipientId: id } },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, title: true, body: true },
  })
}

/** Record that this person tapped OK. Only a message meant for them; repeating it is harmless. */
export async function dismissAnnouncement(client: PrismaClient, type: RecipientType, id: string, announcementId: string): Promise<boolean> {
  const a = await client.announcement.findFirst({ where: { id: announcementId, audience: { in: audiencesFor(type) } }, select: { id: true } })
  if (!a) return false
  await client.announcementDismissal.upsert({
    where: { announcementId_recipientType_recipientId: { announcementId, recipientType: type, recipientId: id } },
    update: {},
    create: { announcementId, recipientType: type, recipientId: id },
  })
  return true
}
