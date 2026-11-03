import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const STATUSES = ['Active', 'Archived']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const { id } = await params

  const existing = await prisma.department.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const data: { name?: string; description?: string | null; status?: string; leadId?: string | null } = {}

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be blank' }, { status: 400 })
    if (name !== existing.name) {
      if (await prisma.department.findUnique({ where: { name } })) {
        return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
      }
      data.name = name
    }
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== 'string') {
      return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
    }
    data.description = typeof b.description === 'string' ? b.description.trim() || null : null
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "status must be 'Active' or 'Archived'" }, { status: 400 })
    }
    data.status = b.status
  }

  // Owner-only (this route is requireSuperAdmin). The lead must be an Active member of this department.
  if (b.leadId !== undefined) {
    if (b.leadId === null) {
      data.leadId = null
    } else if (typeof b.leadId === 'string' && b.leadId) {
      const lead = await prisma.staffUser.findFirst({
        where: { id: b.leadId, departmentId: id, status: 'Active' },
        select: { id: true },
      })
      if (!lead) return NextResponse.json({ error: 'The lead must be an active member of this department' }, { status: 400 })
      data.leadId = lead.id
    } else {
      return NextResponse.json({ error: 'leadId must be a staff id or null' }, { status: 400 })
    }
  }

  let department
  try {
    department = await prisma.department.update({ where: { id }, data })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
    }
    if ((e as { code?: string })?.code === 'P2025') {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 })
    }
    throw e
  }

  logAudit({
    action: 'department_updated',
    entity: 'Department',
    entityId: id,
    details: `Updated department "${existing.name}": ${Object.keys(data).join(', ') || 'no changes'}`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ department })
}
