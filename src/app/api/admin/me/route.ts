import { NextResponse } from 'next/server'
import { requireAdminArea, actorPermissions, findLeadDepartmentId } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

// The signed-in admin actor's role, per-screen permissions and lead status. Cosmetic input for the UI
// (nav, self-service controls); every route still enforces its own guard. Never returns hashes, only a boolean.
export async function GET() {
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  const id = guard.actor.id
  const perms = await actorPermissions(guard.actor) // fresh read: a revoked/changed role is reflected immediately

  if (guard.actor.type === 'superadmin') {
    const me = id ? await prisma.superAdmin.findUnique({ where: { id }, select: { approvalPin: true } }) : null
    return NextResponse.json({ role: 'superadmin', perms, isLead: false, hasApprovalPin: !!me?.approvalPin })
  }

  const staff = id ? await prisma.staffUser.findUnique({ where: { id }, select: { approvalPin: true } }) : null
  const leadDepartmentId = id ? await findLeadDepartmentId(id) : null
  return NextResponse.json({
    role: 'staff',
    perms,
    isLead: leadDepartmentId != null,
    ...(leadDepartmentId ? { leadDepartmentId } : {}),
    hasApprovalPin: !!staff?.approvalPin,
  })
}
