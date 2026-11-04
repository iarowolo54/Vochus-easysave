// Sign-in alert: every successful agent or online-customer login emails the account holder (CBN fraud-control).
// Best effort by design: a failed or missing email must never block a sign-in.
import { sendMail } from '@/lib/mail'
import { renderEmail } from '@/lib/email-template'

type Recipient = { email: string | null | undefined; name: string }

/** "Tuesday, 3 Nov 2026, 5:42 PM" in Lagos time, whatever timezone the server runs in. */
export function loginTimeLabel(at: Date): string {
  return `${at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })}, ${at
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' })
    .toUpperCase()}`
}

export function loginAlertEmail(name: string, at: Date, via: string): { subject: string; html: string } {
  const subject = 'New sign-in to your Vochus Easy Save account'
  const html = renderEmail({
    subject,
    preheader: `You signed in on ${loginTimeLabel(at)}.`,
    tone: 'warning',
    statusLabel: 'Sign-in alert',
    heading: `Hello ${name}, you signed in`,
    intro: 'You have signed in to your Vochus Easy Save account.',
    rows: [
      ['Date and time', loginTimeLabel(at)],
      ['Signed in with', via],
    ],
    note: 'If you did not sign in, your account may be compromised. Contact your agent or Vochus Easy Save support right away and change your password.',
  })
  return { subject, html }
}

/** Fire-and-forget. Resolves either way; logs only that it failed, never the address. */
export async function sendLoginAlert(to: Recipient, via: 'password' | 'fingerprint', at: Date = new Date()): Promise<void> {
  const email = to.email?.trim()
  if (!email) return
  try {
    const { subject, html } = loginAlertEmail(to.name, at, via === 'fingerprint' ? 'Fingerprint' : 'Password')
    await sendMail({ to: email, subject, html })
  } catch (e) {
    console.error('[login-alert] send failed:', e instanceof Error ? e.message : 'unknown')
  }
}
