import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const body = await req.json()
  const { status } = body as { status: string }

  if (!['Open', 'In Review', 'Resolved'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const report = await prisma.issueReport.update({
    where: { id },
    data: { status },
  })

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'issue_report_status_changed',
    entity: 'IssueReport',
    entityId: id,
    details: `Issue report ${id} status changed to "${status}"`,
    actorType: 'admin',
    actorId: (adminUser as any).id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ report })
}
