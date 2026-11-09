import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { cleanNote } from '@/lib/manual-credit'
import { replaceMember } from '@/lib/ajo-admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('ajo', 'manage')
  if (!guard.ok) return guard.response
  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const note = cleanNote(b.note)
  if (!note) return NextResponse.json({ error: 'Add a short note saying why (3 to 300 characters).' }, { status: 400 })
  if (!b.pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, b.pin)
  if (!pinCheck.ok) return pinCheck.response
  const { id } = await params
  if (typeof b.memberId !== 'string' || !b.memberId) return NextResponse.json({ error: 'Choose a member.' }, { status: 400 })
  const customerCode = typeof b.customerCode === 'string' ? b.customerCode.trim().toUpperCase() : ''
  if (!customerCode) return NextResponse.json({ error: 'Enter the new customer’s ID.' }, { status: 400 })
  const r = await replaceMember(prisma, { groupId: id, memberId: b.memberId, customerCode, note, actor: adminActor(guard.session) })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
}
