import { NextRequest, NextResponse } from 'next/server'
import { adminActor, requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { parseAnnouncement } from '@/lib/announcements'
import { attachPictures, PicturesMissingError, picturesMissingResponse } from '@/lib/announcement-images'

type Ctx = { params: Promise<{ id: string }> }

/** Edit the message, or switch it on/off with { isActive }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('messages', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const existing = await prisma.announcement.findUnique({ where: { id }, select: { id: true, title: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body: unknown = await req.json().catch(() => null)
  const actor = adminActor(guard.session)

  const toggle = body && typeof body === 'object' && Object.keys(body).length === 1 ? (body as { isActive?: unknown }).isActive : undefined
  if (typeof toggle === 'boolean') {
    const a = await prisma.announcement.update({ where: { id }, data: { isActive: toggle } })
    await logAudit({ action: toggle ? 'announcement_switched_on' : 'announcement_switched_off', entity: 'Announcement', entityId: id, details: `Pop-up message "${a.title}"`, actorType: 'admin', ...actor })
    return NextResponse.json({ announcement: a })
  }

  const parsed = parseAnnouncement(body)
  if (!parsed.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })
  const { imageIds, ...fields } = parsed.value
  let a
  try {
    a = await prisma.$transaction(async tx => {
      const row = await tx.announcement.update({ where: { id }, data: fields })
      await attachPictures(tx, id, imageIds)
      return row
    })
  } catch (e) {
    if (e instanceof PicturesMissingError) return picturesMissingResponse()
    throw e
  }
  await logAudit({ action: 'announcement_edited', entity: 'Announcement', entityId: id, details: `Pop-up message "${existing.title}" edited`, actorType: 'admin', ...actor })
  return NextResponse.json({ announcement: a })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('messages', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const existing = await prisma.announcement.findUnique({ where: { id }, select: { title: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.announcement.delete({ where: { id } })
  await logAudit({ action: 'announcement_deleted', entity: 'Announcement', entityId: id, details: `Pop-up message "${existing.title}" deleted`, actorType: 'admin', ...adminActor(guard.session) })
  return NextResponse.json({ ok: true })
}
