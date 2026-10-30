import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'

// Wrong-PIN limit for the super-admin payout approval PIN. Failures are recorded as
// append-only AuditLog rows (shared across PM2 instances, no schema change), and the
// lockout is a sliding window over those rows. The PIN itself is never stored or logged.
export const PIN_MAX_FAILURES = 5
export const PIN_WINDOW_MS = 15 * 60_000
const FAIL_ACTION = 'approval_pin_failed'

type PinResult = { ok: true } | { ok: false; response: NextResponse }

export async function verifyApprovalPin(session: Session, pin: unknown): Promise<PinResult> {
  const user = session.user as { id?: string; email?: string }
  const admin = await prisma.superAdmin.findFirst({
    where: user.id ? { id: user.id } : { email: user.email },
    select: { id: true, name: true, approvalPin: true },
  })
  if (!admin?.approvalPin) {
    return { ok: false, response: NextResponse.json({ error: 'No approval PIN set. Contact system administrator.' }, { status: 403 }) }
  }

  const since = new Date(Date.now() - PIN_WINDOW_MS)
  const failures = await prisma.auditLog.count({
    where: { action: FAIL_ACTION, actorId: admin.id, createdAt: { gte: since } },
  })
  if (failures >= PIN_MAX_FAILURES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' },
        { status: 429 },
      ),
    }
  }

  const valid = await bcrypt.compare(String(pin), admin.approvalPin)
  if (!valid) {
    await prisma.auditLog.create({
      data: {
        action: FAIL_ACTION,
        entity: 'SuperAdmin',
        entityId: admin.id,
        details: 'Incorrect approval PIN',
        actorType: 'admin',
        actorId: admin.id,
        actorName: admin.name,
      },
    })
    return { ok: false, response: NextResponse.json({ error: 'Incorrect PIN' }, { status: 403 }) }
  }
  return { ok: true }
}
