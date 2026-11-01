import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { AREA_KEYS, parsePermissions, type Area } from '@/lib/permissions'

// The signed-in admin actor's role and granted areas. Cosmetic input for the UI (nav, self-service
// controls); every route still enforces its own guard. Never returns hashes, only a boolean.
export async function GET() {
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  const id = guard.actor.id
  if (guard.actor.type === 'superadmin') {
    const me = id ? await prisma.superAdmin.findUnique({ where: { id }, select: { approvalPin: true } }) : null
    return NextResponse.json({ role: 'superadmin', areas: [...AREA_KEYS], hasApprovalPin: !!me?.approvalPin })
  }

  // Fresh read: a revoked/changed role is reflected immediately (the token is not trusted).
  const staff = id
    ? await prisma.staffUser.findUnique({
        where: { id },
        select: { approvalPin: true, roleRef: { select: { status: true, permissions: true } } },
      })
    : null
  const areas: Area[] = staff?.roleRef && staff.roleRef.status === 'Active' ? parsePermissions(staff.roleRef.permissions) : []
  return NextResponse.json({ role: 'staff', areas, hasApprovalPin: !!staff?.approvalPin })
}
