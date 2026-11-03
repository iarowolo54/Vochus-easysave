// Issues (or re-issues) a staff invite: stores only the token hash, emails the set-password link,
// and returns the raw link once so the creator's screen can show it. The link is never stored or logged.
import { prisma } from './prisma'
import { sendMail } from './mail'
import { generateInviteToken, inviteLink } from './invite-token'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function inviteEmailHtml(name: string, link: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#1a5c35">Welcome to Vochus Easy Save, ${escapeHtml(name)}</h2>
      <p>You've been given access to the Vochus Easy Save admin. Choose a password to finish setting up your account.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Set your password</a>
      </div>
      <p style="color:#888;font-size:12px">This link works once and expires in 48 hours. If you did not expect this email, ignore it.</p>
    </div>
  `
}

export async function issueStaffInvite(staff: { id: string; name: string; email: string }): Promise<{ link: string; emailed: boolean }> {
  const token = generateInviteToken()
  await prisma.staffUser.update({
    where: { id: staff.id },
    data: { inviteTokenHash: token.hash, inviteExpiresAt: token.expiresAt, status: 'Invited', password: null },
  })
  const link = inviteLink(token.raw)

  // SMTP is production-only; a mail failure never fails the invite (the creator still gets the link).
  let emailed = false
  if (process.env.NODE_ENV === 'production') {
    try {
      await sendMail({ to: staff.email, subject: 'Set up your Vochus Easy Save admin account', html: inviteEmailHtml(staff.name, link) })
      emailed = true
    } catch (err) {
      console.error('staff invite email failed:', err instanceof Error ? err.message : 'unknown')
    }
  }
  return { link, emailed }
}
