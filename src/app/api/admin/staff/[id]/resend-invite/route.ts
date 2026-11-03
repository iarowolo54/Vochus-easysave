import { NextRequest, NextResponse } from 'next/server'
import { actorPermissions, adminActor, requireDeptManage, requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { issueStaffInvite } from '@/lib/staff-invite'
import { canGrant, parsePermissions } from '@/lib/permissions'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const staff = await prisma.staffUser.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, status: true, departmentId: true, roleRef: { select: { permissions: true } } },
  })
  // The owner, or the lead of the staffer's own department (re-checked fresh).
  let actor: { id?: string; name: string; type: 'superadmin' | 'staff' }
  if (staff?.departmentId) {
    const guard = await requireDeptManage(staff.departmentId)
    if (!guard.ok) return guard.response
    actor = guard.actor
  } else {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response
    const a = adminActor(guard.session)
    actor = { id: a.actorId, name: a.actorName, type: 'superadmin' }
  }
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
  if (staff.status !== 'Invited') return NextResponse.json({ error: 'Only pending invites can be re-sent' }, { status: 400 })

  // A lead can't re-invite someone whose role is above the lead's own access.
  if (actor.type === 'staff' && !canGrant(await actorPermissions(actor), parsePermissions(staff.roleRef?.permissions))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const issued = await issueStaffInvite(staff)
  if (!issued) return NextResponse.json({ error: 'Only pending invites can be re-sent' }, { status: 409 })
  await logAudit({
    action: 'staff_invite_resent',
    entity: 'StaffUser',
    entityId: staff.id,
    details: `Re-sent the invite to ${staff.name} (${staff.email}); the previous link no longer works`,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
  })
  // The raw link is a bearer credential for the account: only the owner is shown it. Everyone else
  // relies on the email to the invitee.
  return NextResponse.json({ ok: true, emailed: issued.emailed, ...(actor.type === 'superadmin' ? { link: issued.link } : {}) })
}
