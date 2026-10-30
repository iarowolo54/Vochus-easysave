import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'

// Wrong-PIN limit for the super-admin payout approval PIN: a per-admin attempt counter
// (shared across PM2 instances) reserved atomically before the compare. The PIN is never stored or logged.
export const PIN_MAX_FAILURES = 5
export const PIN_WINDOW_MS = 15 * 60_000

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

  // Reserve an attempt slot BEFORE comparing. The increment is one atomic updateMany gated on
  // count < MAX, so N concurrent guesses can reserve at most MAX slots (no overshoot).
  const now = new Date()
  const since = new Date(now.getTime() - PIN_WINDOW_MS)
  await prisma.approvalPinAttempt.upsert({
    where: { adminId: admin.id },
    create: { adminId: admin.id, windowStart: now, count: 0 },
    update: {},
  })
  await prisma.approvalPinAttempt.updateMany({
    where: { adminId: admin.id, windowStart: { lt: since } },
    data: { windowStart: now, count: 0 },
  })
  const reserved = await prisma.approvalPinAttempt.updateMany({
    where: { adminId: admin.id, count: { lt: PIN_MAX_FAILURES } },
    data: { count: { increment: 1 } },
  })
  if (reserved.count === 0) {
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
    return { ok: false, response: NextResponse.json({ error: 'Incorrect PIN' }, { status: 403 }) }
  }
  await prisma.approvalPinAttempt.update({
    where: { adminId: admin.id },
    data: { count: 0, windowStart: new Date() },
  })
  return { ok: true }
}
