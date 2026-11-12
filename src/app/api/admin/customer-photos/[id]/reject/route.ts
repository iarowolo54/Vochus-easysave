import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { rejectPhotoRequest } from '@/lib/customer-photo-request'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { reason?: unknown; seenSubmittedAt?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  const r = await rejectPhotoRequest(prisma, { id, admin: guard.actor, reason, seenSubmittedAt: body?.seenSubmittedAt })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
