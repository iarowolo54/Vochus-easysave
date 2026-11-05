import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { cleanNote, creditRequestByHand } from '@/lib/manual-credit'

export async function POST(req: NextRequest) {
  const guard = await requirePermission('bank-transfers', 'manage')
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const note = cleanNote(b.note)
  if (!note) return NextResponse.json({ error: 'Add a short note saying why (3 to 300 characters).' }, { status: 400 })
  if (!b.pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, b.pin)
  if (!pinCheck.ok) return pinCheck.response
  const admin = { id: adminActor(guard.session).actorId, name: guard.actor.name }

  if (typeof b.ref !== 'string' || !b.ref) return NextResponse.json({ error: 'Missing transfer.' }, { status: 400 })
  const r = await creditRequestByHand(prisma, { ref: b.ref, admin, note, ackLookalike: b.ackLookalike === true })
  return r.ok ? NextResponse.json({ ok: true, amount: r.amount }) : NextResponse.json({ error: r.error }, { status: r.status })
}
