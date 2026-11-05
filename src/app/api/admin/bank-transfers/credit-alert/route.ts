import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { cleanNote, creditAlertByHand, type AlertTarget } from '@/lib/manual-credit'

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

  if (typeof b.alertId !== 'string' || !b.alertId) return NextResponse.json({ error: 'Missing held payment.' }, { status: 400 })
  const t = (b.target && typeof b.target === 'object' ? b.target : {}) as Record<string, unknown>
  let target: AlertTarget | null = null
  if (t.kind === 'customer' && typeof t.customerId === 'string' && typeof t.planId === 'string') target = { kind: 'customer', customerId: t.customerId, planId: t.planId }
  if (t.kind === 'agent' && typeof t.agentId === 'string') target = { kind: 'agent', agentId: t.agentId }
  if (!target) return NextResponse.json({ error: 'Choose who to credit.' }, { status: 400 })
  const r = await creditAlertByHand(prisma, { alertId: b.alertId, target, admin, note, ackLookalike: b.ackLookalike === true })
  return r.ok ? NextResponse.json({ ok: true, amount: r.amount }) : NextResponse.json({ error: r.error }, { status: r.status })
}
