// Pop-up messages from super admin, shown to agents and/or customers every time they sign in or open the app until
// the end date (owner's choice, Nov 2026). A title, plain text and up to five pictures. Dates are Lagos calendar days.
import type { PrismaClient } from '@prisma/client'

export const AUDIENCES = ['agents', 'customers', 'both'] as const
export type Audience = (typeof AUDIENCES)[number]
export type RecipientType = 'agent' | 'customer'

export const TITLE_MAX = 80
export const BODY_MAX = 600
export const IMAGES_MAX = 5
export const IMAGE_BYTES_MAX = 2 * 1024 * 1024

export const AUDIENCE_LABEL: Record<Audience, string> = { agents: 'Agents', customers: 'Customers', both: 'Agents and customers' }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Lagos is UTC+1 all year (no daylight saving). */
const lagosStart = (day: string) => new Date(`${day}T00:00:00+01:00`)
const lagosEnd = (day: string) => new Date(`${day}T23:59:59.999+01:00`)

export type AnnouncementInput = { title: string; body: string; audience: Audience; startsAt: Date; endsAt: Date; imageIds: string[] }

/** Narrow an untrusted body into a message, or say what's wrong (field → message). */
export function parseAnnouncement(raw: unknown): { ok: true; value: AnnouncementInput } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Record<string, string> = {}
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  const audience = b.audience
  const start = typeof b.startDate === 'string' ? b.startDate : ''
  const end = typeof b.endDate === 'string' ? b.endDate : ''
  const rawIds: unknown[] = Array.isArray(b.imageIds) ? b.imageIds : []
  const imageIds = rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (!title) errors.title = 'Enter a title.'
  else if (title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters.`
  if (imageIds.length !== rawIds.length || new Set(imageIds).size !== imageIds.length) errors.imageIds = 'Add the pictures again.'
  else if (imageIds.length > IMAGES_MAX) errors.imageIds = `A message can have up to ${IMAGES_MAX} pictures.`
  if (!body && imageIds.length === 0) errors.body = 'Enter the message or add a picture.'
  else if (body.length > BODY_MAX) errors.body = `Keep the message to ${BODY_MAX} characters.`
  if (!AUDIENCES.includes(audience as Audience)) errors.audience = 'Choose who sees it.'
  if (!DAY_RE.test(start) || Number.isNaN(lagosStart(start).getTime())) errors.startDate = 'Choose a start date.'
  if (!DAY_RE.test(end) || Number.isNaN(lagosEnd(end).getTime())) errors.endDate = 'Choose an end date.'
  else if (!errors.startDate && end < start) errors.endDate = 'The end date can’t be before the start date.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { title, body, audience: audience as Audience, startsAt: lagosStart(start), endsAt: lagosEnd(end), imageIds } }
}

/** The audiences that include this kind of person. */
export function audiencesFor(type: RecipientType): Audience[] {
  return type === 'agent' ? ['agents', 'both'] : ['customers', 'both']
}

/** Every message showing now for this kind of person, oldest first. Closing one doesn't stop it showing next time. */
export async function currentAnnouncements(client: PrismaClient, type: RecipientType, now: Date = new Date()) {
  const rows = await client.announcement.findMany({
    where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now }, audience: { in: audiencesFor(type) } },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, body: true, images: { orderBy: { position: 'asc' }, select: { id: true } } },
  })
  return rows.map(({ images, ...r }) => ({ ...r, imageIds: images.map(i => i.id) }))
}

/** Count this person as having closed the message. Only a message meant for them; repeating it is harmless. */
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
