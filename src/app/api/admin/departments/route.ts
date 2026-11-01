import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const rows = await prisma.department.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      _count: { select: { roles: true } },
    },
  })
  const departments = rows.map(({ _count, ...d }) => ({ ...d, roleCount: _count.roles }))
  return NextResponse.json({ departments })
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') {
    return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
  }
  const description = typeof b.description === 'string' ? b.description.trim() || null : null

  if (await prisma.department.findUnique({ where: { name } })) {
    return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
  }

  let department
  try {
    department = await prisma.department.create({
      data: { name, description, status: 'Active' },
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
    }
    throw e
  }

  logAudit({
    action: 'department_created',
    entity: 'Department',
    entityId: department.id,
    details: `Created department "${name}"`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ department }, { status: 201 })
}
