import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, isNotFound } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('oversight')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const status = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined

  if (typeof status !== 'string' || !['Open', 'In Review', 'Resolved'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const report = await prisma.issueReport.update({
    where: { id },
    data: { status },
  }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  logAudit({
    action: 'issue_report_status_changed',
    entity: 'IssueReport',
    entityId: id,
    details: `Issue report ${id} status changed to "${status}"`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ report })
}
