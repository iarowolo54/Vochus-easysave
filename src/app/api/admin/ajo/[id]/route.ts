import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { loadGroup } from '@/lib/ajo-server'

/** One group's members and turns, for the staff Manage screen. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('ajo', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const group = await loadGroup(prisma, { id })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ group }, { headers: { 'Cache-Control': 'no-store' } })
}
