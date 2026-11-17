// Emails and the welcome text for cash-saver registration requests. Best-effort: a failed send never touches the request or the decision.
// The photo, BVN and full phone number stay in the app.
import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { renderEmail, type EmailContent } from '@/lib/email-template'
import { emailAction } from '@/lib/email-brand'
import { displayName, formatNaira } from '@/lib/format'

async function send(to: string, email: EmailContent): Promise<void> {
  // sendMail has no environment gate of its own.
  if (process.env.NODE_ENV !== 'production') return
  try {
    await sendMail({ to, subject: email.subject, html: renderEmail(email) })
  } catch (err) {
    console.error('[customer-request-email] send failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

export async function emailRequestSubmitted(client: Pick<PrismaClient, 'superAdmin'>, input: { customerName: string; agentName: string; agentCode: string; resubmitted: boolean }): Promise<void> {
  try {
    const admins = await client.superAdmin.findMany({ where: { email: { not: '' } }, select: { email: true } })
    const name = displayName(input.customerName)
    const action = emailAction('Review request', '/superadmin/customer-requests')
    await Promise.all(admins.map(a => send(a.email, {
      subject: `Customer request: ${name}`,
      preheader: `${input.agentName} ${input.resubmitted ? 'sent this request again' : 'wants to register a cash saver'}.`,
      tone: 'warning', audience: 'staff', statusLabel: 'Waiting for you',
      heading: input.resubmitted ? 'A request was sent again' : 'New customer request',
      intro: `${input.agentName} ${input.resubmitted ? 'has fixed and resent the request for' : 'wants to register'} ${name}. Check the passport photograph and details, then approve or deny it.`,
      rows: [['Customer', name], ['Agent', `${input.agentName} (${input.agentCode})`]],
      action,
      note: action ? undefined : 'Review it under Sign-ups & photos in the admin area.',
    })))
  } catch (err) {
    console.error('[customer-request-email] admin list failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

export async function emailRequestApproved(agent: { email: string | null }, input: { customerName: string; customerCode: string; fee: number }): Promise<void> {
  if (!agent.email) return
  const name = displayName(input.customerName)
  await send(agent.email, {
    subject: `Approved: ${name}`,
    preheader: `${name} is now your customer.`,
    tone: 'success', audience: 'agent', statusLabel: '',
    heading: 'Customer approved',
    intro: `${name} is now your customer. You can record their savings.`,
    rows: [['Customer', name], ['Customer ID', input.customerCode], ['Fee taken from your wallet', formatNaira(input.fee, { minor: false })]],
  })
}

export async function emailRequestDenied(agent: { email: string | null }, input: { customerName: string; reason: string; fix: string }): Promise<void> {
  if (!agent.email) return
  const name = displayName(input.customerName)
  await send(agent.email, {
    subject: `Denied: ${name}`,
    preheader: 'See what to fix, then send it again.',
    tone: 'danger', audience: 'agent', statusLabel: '',
    heading: 'Customer request denied',
    intro: `The request for ${name} wasn’t approved. Nothing was taken from your wallet.`,
    reason: { label: 'Reason', text: input.reason },
    nextStep: 'Open Sign-ups & upgrades in the app, fix it and send it again.',
    action: emailAction('Open Vochus Easy Save', '/login'),
    rows: [['Customer', name], ['What to work on', input.fix]],
  })
}

/** The one text a cash saver gets for registering, once the account really exists. No codes in it. */
export function welcomeText(input: { firstName: string; customerCode: string; agentName: string }): string {
  return `Welcome to Vochus Easy Save, ${displayName(input.firstName)}. Your savings account is open. Customer ID ${input.customerCode}. Your agent is ${displayName(input.agentName)}.`
}

export async function textCustomerWelcome(customer: { firstName: string; phone: string }, input: { customerCode: string; agentName: string }): Promise<void> {
  try {
    // sms: cash saver registration, owner approved 2026-11-10; sent once, when the super admin approves
    await sendSMS(customer.phone, welcomeText({ firstName: customer.firstName, ...input }))
  } catch (err) {
    console.error('[customer-request-email] welcome text failed:', err instanceof Error ? err.message : 'unknown error')
  }
}
