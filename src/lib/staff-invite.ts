// Issues (or re-issues) a staff invite: stores only the token hash, emails the set-password link,
// and returns the raw link once so the creator's screen can show it. The link is never stored or logged.
import { renderEmail } from './email-template'
import { prisma } from './prisma'
import { sendMail } from './mail'
import { generateInviteToken, inviteLink } from './invite-token'

export function inviteEmailHtml(name: string, link: string): string {
  return renderEmail({
    subject: 'Set up your Vochus Easy Save admin account',
    preheader: 'Choose a password to finish setting up your account.',
    tone: 'success',
    statusLabel: '',
    audience: 'staff',
    heading: `Welcome to Vochus Easy Save, ${name}`,
    intro: "You've been given access to the Vochus Easy Save admin. Choose a password to finish setting up your account.",
    action: { label: 'Set your password', url: link },
    rows: [],
    note: 'This link works once and expires in 48 hours. If you did not expect this email, ignore it.',
  })
}

/**
 * Only a still-Invited account can be (re-)invited: the write is conditional, so an account that
 * activated or was suspended in the meantime is never reset. Returns null (no mail, no link) then.
 */
export async function issueStaffInvite(staff: { id: string; name: string; email: string }): Promise<{ link: string; emailed: boolean } | null> {
  const token = generateInviteToken()
  const updated = await prisma.staffUser.updateMany({
    where: { id: staff.id, status: 'Invited' },
    data: { inviteTokenHash: token.hash, inviteExpiresAt: token.expiresAt },
  })
  if (updated.count === 0) return null
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
