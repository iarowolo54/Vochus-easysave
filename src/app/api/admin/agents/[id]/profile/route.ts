import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { findIdentityConflict } from '@/lib/identity'
import { AGENT_PROFILE_FIELDS, describeChanges, diffProfile, formValue } from '@/lib/profile-edit'

type Ctx = { params: Promise<{ id: string }> }
const select = Object.fromEntries(AGENT_PROFILE_FIELDS.map(f => [f.key, true])) as Record<string, true>

/** The agent's editable details, as the edit form shows them. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const a = await prisma.agent.findUnique({ where: { id }, select })
  if (!a) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const values = Object.fromEntries(AGENT_PROFILE_FIELDS.map(f => [f.key, formValue(f.kind, (a as Record<string, unknown>)[f.key])]))
  const canManage = (await requirePermission('agents', 'manage')).ok
  return NextResponse.json({ values, canManage })
}

/** Staff correct an agent's details. A new phone or email needs the approval PIN; every change is audited. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const values = (body && typeof body === 'object' ? (body as { values?: unknown }).values : null) ?? {}

  const current = await prisma.agent.findUnique({ where: { id }, select: { ...select, id: true, agentId: true, name: true } })
  if (!current) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const diff = diffProfile(AGENT_PROFILE_FIELDS, current, values, { dobAs: 'text' })
  if (!diff.ok) return NextResponse.json({ error: diff.error }, { status: 400 })
  if (diff.changes.length === 0) return NextResponse.json({ error: 'Nothing has changed.' }, { status: 400 })

  if (diff.needsPin) {
    const pin = await verifyApprovalPin(guard.session, (body as { pin?: unknown }).pin)
    if (!pin.ok) return pin.response
  }
  if (diff.changes.some(c => c.key === 'phone' || c.key === 'email')) {
    const conflict = await findIdentityConflict(prisma, {
      phone: typeof diff.data.phone === 'string' ? diff.data.phone : null,
      email: typeof diff.data.email === 'string' ? diff.data.email : null,
    }, { excludeAgentId: id })
    if (conflict) return NextResponse.json({ error: `That ${conflict === 'phone' ? 'phone number' : 'email'} already belongs to another account.` }, { status: 409 })
  }

  const emailChanged = diff.changes.some(c => c.key === 'email')
  // A new email has to be confirmed again; staff can send the link with Resend verification.
  await prisma.agent.update({ where: { id }, data: { ...diff.data, ...(emailChanged && { emailVerified: false, emailVerifyToken: null }) } })

  logAudit({
    action: 'agent_profile_edited',
    entity: 'Agent',
    entityId: id,
    details: `Details changed for agent ${current.name} (${current.agentId}): ${describeChanges(diff.changes)}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ changed: diff.changes.map(c => c.label) })
}
