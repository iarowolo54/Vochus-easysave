// Pictures on pop-up messages (server only). Each is uploaded on its own before the message is saved, then attached
// when it is, and served by link so a phone downloads it once however often the pop-up shows.
import { NextResponse } from 'next/server'
import type { Prisma, PrismaClient } from '@prisma/client'
import { detectType } from '@/lib/upload-safety'
import { audiencesFor, IMAGE_BYTES_MAX, type RecipientType } from '@/lib/announcements'

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const WRONG_TYPE = 'Use a JPG, PNG or WebP picture.'
const DAY_MS = 86_400_000

/** What an uploaded file really is, judged by its bytes, or what's wrong with it. */
export function checkPicture(bytes: Buffer): { ok: true; mime: string } | { ok: false; error: string } {
  if (bytes.length > IMAGE_BYTES_MAX) return { ok: false, error: `Keep each picture under ${IMAGE_BYTES_MAX / (1024 * 1024)} MB.` }
  const mime = detectType(bytes)
  if (!mime || !PICTURE_TYPES.includes(mime)) return { ok: false, error: WRONG_TYPE }
  return { ok: true, mime }
}

/** Store an uploaded picture, not yet on any message. Clears pictures from forms that were abandoned. */
export async function storePicture(client: PrismaClient, bytes: Buffer, mime: string, now: Date = new Date()) {
  await client.announcementImage.deleteMany({ where: { announcementId: null, createdAt: { lt: new Date(now.getTime() - DAY_MS) } } })
  // Prisma 5 types Bytes as Buffer.
  return client.announcementImage.create({ data: { mime, data: bytes }, select: { id: true } })
}

export class PicturesMissingError extends Error {}

export const picturesMissingResponse = () =>
  NextResponse.json({ error: 'Check the highlighted fields.', errors: { imageIds: 'A picture was lost. Remove it and add it again.' } }, { status: 400 })

/** Make these pictures, in this order, the message's whole set. Run inside the transaction that saves the message. */
export async function attachPictures(tx: Prisma.TransactionClient, announcementId: string, imageIds: string[]) {
  const usable = await tx.announcementImage.count({
    where: { id: { in: imageIds }, OR: [{ announcementId: null }, { announcementId }] },
  })
  if (usable !== imageIds.length) throw new PicturesMissingError()
  await tx.announcementImage.deleteMany({ where: { announcementId, id: { notIn: imageIds } } })
  for (const [position, id] of imageIds.entries()) {
    await tx.announcementImage.update({ where: { id }, data: { announcementId, position } })
  }
}

/** A picture on a message meant for this kind of person, or null. */
export function pictureForRecipient(client: PrismaClient, imageId: string, type: RecipientType) {
  return client.announcementImage.findFirst({
    where: { id: imageId, announcement: { audience: { in: audiencesFor(type) } } },
    select: { mime: true, data: true },
  })
}

/** A picture's bytes. A stored picture never changes, so the phone can keep it; nothing here can run as a page. */
export function pictureResponse(picture: { mime: string; data: Uint8Array }) {
  return new NextResponse(new Uint8Array(picture.data), {
    headers: {
      'Content-Type': picture.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
}
