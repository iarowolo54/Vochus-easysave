import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { approvePhotoRequest } from '@/lib/customer-photo-request'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await approvePhotoRequest(prisma, { id, admin: guard.actor })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
