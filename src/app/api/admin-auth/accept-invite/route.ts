import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { hashInviteToken, isInviteUsable } from '@/lib/invite-token'
import { ADMIN_QUIET_MS, refundAttempt, reserveAttempt } from '@/lib/login-attempt'

const MIN_PASSWORD = 8
const ATTEMPT_LIMIT = 5
const LOCK_STEPS_MS = [15 * 60_000, 60 * 60_000]
const INVALID = 'This link is invalid or has expired. Ask your administrator to send a new invite.'

// Public: the token is the credential. A token that matches no staffer fails generically with no DB write.
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null)
  const { token, newPassword } = (body && typeof body === 'object' ? body : {}) as { token?: unknown; newPassword?: unknown }
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return NextResponse.json({ error: INVALID }, { status: 400 })
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > 128) {
    return NextResponse.json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` }, { status: 400 })
  }

  const staff = await prisma.staffUser.findFirst({ where: { inviteTokenHash: hashInviteToken(token) } })
  if (!staff) return NextResponse.json({ error: INVALID }, { status: 400 })

  // Bound repeated submissions against one (possibly leaked) link, keyed on the resolved staffer.
  const key = `invite:${staff.id}`
  const slot = await reserveAttempt(key, ATTEMPT_LIMIT, LOCK_STEPS_MS, ADMIN_QUIET_MS)
  if (!slot.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a while and try again.' }, { status: 429 })
  }
  if (!isInviteUsable(staff, new Date())) return NextResponse.json({ error: INVALID }, { status: 400 })

  // Single-use: the conditional update only wins once, even for two simultaneous submissions.
  const hash = await bcrypt.hash(newPassword, 12)
  const done = await prisma.staffUser.updateMany({
    where: { id: staff.id, status: 'Invited', inviteTokenHash: staff.inviteTokenHash },
    data: { password: hash, status: 'Active', inviteTokenHash: null, inviteExpiresAt: null },
  })
  if (done.count === 0) return NextResponse.json({ error: INVALID }, { status: 400 })

  await refundAttempt(key, slot.startedLock).catch(() => {})
  await logAudit({
    action: 'staff_invite_accepted',
    entity: 'StaffUser',
    entityId: staff.id,
    details: `${staff.name} (${staff.email}) set their password and activated their account`,
    actorType: 'staff',
    actorId: staff.id,
    actorName: staff.name,
  })
  return NextResponse.json({ ok: true })
}
