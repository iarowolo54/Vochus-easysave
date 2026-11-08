import { NextRequest, NextResponse } from 'next/server'
import { adminActor, requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { AUDIENCE_LABEL, parseAnnouncement } from '@/lib/announcements'

export async function GET() {
  const guard = await requirePermission('messages', 'view')
  if (!guard.ok) return guard.response
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, title: true, body: true, audience: true, startsAt: true, endsAt: true, isActive: true, createdBy: true, createdAt: true, _count: { select: { dismissals: true } } },
  })
  return NextResponse.json({ announcements: rows.map(({ _count, ...r }) => ({ ...r, seenBy: _count.dismissals })) })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('messages', 'manage')
  if (!guard.ok) return guard.response
  const parsed = parseAnnouncement(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })

  const actor = adminActor(guard.session)
  const a = await prisma.announcement.create({ data: { ...parsed.value, createdBy: actor.actorName } })
  await logAudit({
    action: 'announcement_created', entity: 'Announcement', entityId: a.id,
    details: `Pop-up message "${a.title}" for ${AUDIENCE_LABEL[parsed.value.audience].toLowerCase()}, ${a.startsAt.toISOString().slice(0, 10)} to ${a.endsAt.toISOString().slice(0, 10)}`,
    actorType: 'admin', ...actor,
  })
  return NextResponse.json({ announcement: a })
}
