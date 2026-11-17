// Emails for customer → agent requests (src/lib/agent-upgrade.ts). Best-effort: a failed send never touches the request.
// No SMS in this flow: these are online customers, reached by email. NIN and BVN stay in the app.
// The customer hears nothing until approval: the request is the agent's, sent from the details alone.
import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { renderEmail, type EmailContent } from '@/lib/email-template'
import { emailAction } from '@/lib/email-brand'
import { displayName } from '@/lib/format'

async function send(to: string, email: EmailContent): Promise<void> {
  // sendMail has no environment gate of its own.
  if (process.env.NODE_ENV !== 'production') return
  try {
    await sendMail({ to, subject: email.subject, html: renderEmail(email) })
  } catch (err) {
    console.error('[agent-upgrade-email] send failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

/** To every super admin: a request (or a resent one) is waiting for a decision. */
export async function emailAdminsWaiting(client: Pick<PrismaClient, 'superAdmin'>, input: { customerName: string; agentName: string; agentCode: string; resubmitted: boolean }): Promise<void> {
  try {
    const admins = await client.superAdmin.findMany({ where: { email: { not: '' } }, select: { email: true } })
    const name = displayName(input.customerName)
    const action = emailAction('Review request', '/superadmin/agent-requests')
    await Promise.all(admins.map(a => send(a.email, {
      subject: `Customer upgrade: ${name}`,
      preheader: `${input.agentName} ${input.resubmitted ? 'sent this request again' : 'wants this customer to become an agent'}.`,
      tone: 'warning', audience: 'staff', statusLabel: 'Waiting for you',
      heading: input.resubmitted ? 'A customer upgrade was sent again' : 'New customer upgrade',
      intro: `${input.agentName} ${input.resubmitted ? `has fixed and resent the request for ${name}.` : `wants ${name} to become an agent.`} Check their details and savings history, then approve or turn it down.`,
      rows: [['Customer', name], ['Agent', `${input.agentName} (${input.agentCode})`]],
      action,
      note: action ? undefined : 'Review it under Customer upgrades in the admin area.',
    })))
  } catch (err) {
    console.error('[agent-upgrade-email] admin list failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

/** Approved: the person (now an agent) and the agent who asked. */
export async function emailApproved(input: { email: string | null; customerName: string; newAgentCode: string; requester: { email: string | null } }): Promise<void> {
  const name = displayName(input.customerName)
  if (input.email) await send(input.email, {
    subject: 'You’re now a Vochus Easy Save agent',
    preheader: `Your agent ID is ${input.newAgentCode}.`,
    tone: 'success', audience: 'agent', statusLabel: '',
    heading: `Welcome, ${name}`,
    intro: 'You’re now an agent. Sign in to the agent app with the same phone number and password you used before, then upload your documents. You can start working once the office approves them. Your savings account is closed and its history stays on record.',
    rows: [['Agent ID', input.newAgentCode]],
    action: emailAction('Sign in as an agent', '/login'),
  })
  if (input.requester.email) await send(input.requester.email, {
    subject: `Approved: ${name} is now an agent`,
    preheader: `Agent ID ${input.newAgentCode}.`,
    tone: 'success', audience: 'agent', statusLabel: '',
    heading: 'Upgrade approved',
    intro: `${name} is now an agent and is no longer your customer. They’ll upload their own documents before they can start.`,
    rows: [['New agent', name], ['Agent ID', input.newAgentCode]],
  })
}

/** Turned down: only the agent who asked hears, with the reason and what to work on. */
export async function emailDenied(input: { customerName: string; requester: { email: string | null }; reason: string; fix: string }): Promise<void> {
  const name = displayName(input.customerName)
  if (input.requester.email) await send(input.requester.email, {
    subject: `Not approved: ${name}`,
    preheader: 'See what to work on, then send it again.',
    tone: 'danger', audience: 'agent', statusLabel: '',
    heading: 'Upgrade not approved',
    intro: `The upgrade for ${name} to become an agent wasn’t approved.`,
    reason: { label: 'Reason', text: input.reason },
    nextStep: 'Open Sign-ups & upgrades, then Upgrades, in the app. Fix it and send it again.',
    action: emailAction('Open Vochus Easy Save', '/login'),
    rows: [['Customer', name], ['What to work on', input.fix]],
  })
}
