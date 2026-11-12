// The customer photo deadline (docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md).
// One deadline for everyone, stored once at go-live. Before it, customers with no photo are warned (green, yellow,
// red by the day); from it, nobody can START a saving for them until a photo is on the account. A photo waiting for
// the super admin doesn't count. Money already sent is never refused: only the places that start a saving call this.
import { NextResponse } from 'next/server'
import type { PrismaClient } from '@prisma/client'

export const PHOTO_DEADLINE_KEY = 'photoDeadline'
export const PHOTO_REQUIRED = 'PHOTO_REQUIRED'

const HOUR = 3600e3
const DAY = 24 * HOUR
/** Lagos time is UTC+1 all year. */
const WAT = HOUR

/** 00:00 WAT starting the 4th day, where the go-live day (in WAT) is day 1. */
export function deadlineFromGoLive(goLive: Date): Date {
  const w = new Date(goLive.getTime() + WAT)
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + 3) - WAT)
}

export type PhotoPhase = 'none' | 'green' | 'yellow' | 'red' | 'paused'

export function photoPhase(deadline: Date | null, now: Date): PhotoPhase {
  if (!deadline) return 'none'
  const left = deadline.getTime() - now.getTime()
  if (left <= 0) return 'paused'
  if (left <= DAY) return 'red'
  if (left <= 2 * DAY) return 'yellow'
  return 'green'
}

/** The last day saving still works, as the screens show it, e.g. "Sat 15 Nov". */
export function lastSaveDay(deadline: Date): string {
  return new Date(deadline.getTime() - 1).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
}

export function photoBlockMessage(o: { hasPhoto: boolean; deadline: Date | null; now: Date; who: 'customer' | 'agent'; firstName: string }): string | null {
  if (o.hasPhoto || photoPhase(o.deadline, o.now) !== 'paused') return null
  return o.who === 'customer' ? 'Saving is paused until you add your photo.' : `Saving is paused until ${o.firstName}’s photo is added.`
}

export type PhotoStatus = 'ok' | 'missing' | 'pending' | 'rejected'

export function photoStatusOf(hasPhoto: boolean, latestRequest: { status: string; rejectReason: string | null } | null): { status: PhotoStatus; rejectReason: string | null } {
  if (hasPhoto) return { status: 'ok', rejectReason: null }
  if (latestRequest?.status === 'Pending') return { status: 'pending', rejectReason: null }
  if (latestRequest?.status === 'Rejected') return { status: 'rejected', rejectReason: latestRequest.rejectReason }
  return { status: 'missing', rejectReason: null }
}

export async function getPhotoDeadline(client: Pick<PrismaClient, 'platformSetting'>): Promise<Date | null> {
  const row = await client.platformSetting.findUnique({ where: { key: PHOTO_DEADLINE_KEY } })
  if (!row) return null
  const d = new Date(row.value)
  return isNaN(d.getTime()) ? null : d
}

/** Why saving for this customer can't start now, or null. Reads fresh every call, so a new photo unblocks at once. */
export async function photoSaveBlock(client: PrismaClient, customerId: string, who: 'customer' | 'agent', now: Date = new Date()): Promise<string | null> {
  const deadline = await getPhotoDeadline(client)
  if (photoPhase(deadline, now) !== 'paused') return null
  const c = await client.customer.findUnique({ where: { id: customerId }, select: { firstName: true, photoUrl: true } })
  if (!c) return null
  // Only the presence of the photo matters here; the base64 is read once and dropped.
  return photoBlockMessage({ hasPhoto: !!c.photoUrl, deadline, now, who, firstName: c.firstName })
}

export function photoBlockedResponse(message: string): NextResponse {
  return NextResponse.json({ error: message, code: PHOTO_REQUIRED }, { status: 403 })
}

/** Of these customers, the ones saving is paused for right now (no photo after the deadline). Empty before it. */
export async function photoBlockedIds(client: PrismaClient, customerIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (!customerIds.length || photoPhase(await getPhotoDeadline(client), now) !== 'paused') return new Set()
  const rows = await client.customer.findMany({ where: { id: { in: customerIds }, OR: [{ photoUrl: null }, { photoUrl: '' }] }, select: { id: true } })
  return new Set(rows.map(r => r.id))
}
