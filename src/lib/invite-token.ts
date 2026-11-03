// Staff invite tokens: 32 random bytes handed to the invitee once, stored only as a SHA-256 hash.
import { createHash, randomBytes } from 'node:crypto'

export const INVITE_TTL_MS = 48 * 60 * 60 * 1000

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateInviteToken(now: number = Date.now()): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('hex')
  return { raw, hash: hashInviteToken(raw), expiresAt: new Date(now + INVITE_TTL_MS) }
}

export function isInviteUsable(
  staff: { inviteTokenHash: string | null; inviteExpiresAt: Date | null; status: string },
  now: Date,
): boolean {
  return (
    staff.status === 'Invited' &&
    !!staff.inviteTokenHash &&
    !!staff.inviteExpiresAt &&
    staff.inviteExpiresAt.getTime() > now.getTime()
  )
}

/** The set-password link for a raw token. NEXTAUTH_URL is the app host (same as resend-verification). */
export function inviteLink(raw: string): string {
  const base = process.env.NEXTAUTH_URL
  if (!base) throw new Error('NEXTAUTH_URL is not set')
  return `${base.replace(/\/$/, '')}/superadmin/accept-invite?token=${raw}`
}
