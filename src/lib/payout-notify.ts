import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { emailLogo } from '@/lib/email-brand'
import { formatNaira } from '@/lib/format'
import type { CustomerType } from '@/lib/customer-type'

type Client = Pick<PrismaClient, 'superAdmin'>
type Contact = { email: string | null; phone: string }
type Channel = { via: 'email'; to: string } | { via: 'sms'; to: string }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

function hasEmail(email: string | null): email is string {
  return typeof email === 'string' && email.trim() !== ''
}

/** Agents get email when they have one, otherwise SMS. */
export function agentNotifyChannel(agent: Contact): Channel {
  return hasEmail(agent.email) ? { via: 'email', to: agent.email } : { via: 'sms', to: agent.phone }
}

/** Offline customers (market women) always get SMS; online customers get email when they have one. */
export function customerNotifyChannel(customer: Contact, type: CustomerType): Channel {
  if (type === 'online' && hasEmail(customer.email)) return { via: 'email', to: customer.email }
  return { via: 'sms', to: customer.phone }
}

function emailHtml(lines: string[]): string {
  return `<div>${emailLogo()}</div>` + lines.map((l) => `<p>${l}</p>`).join('')
}

/**
 * Dispatch over the chosen channel. sendMail has no environment gate, so email only goes out in
 * production; sendSMS self-gates. Never throws.
 */
async function dispatch(channel: Channel, subject: string, smsText: string, htmlLines: string[]): Promise<void> {
  try {
    if (channel.via === 'sms') {
      await sendSMS(channel.to, smsText)
      return
    }
    if (process.env.NODE_ENV !== 'production') return
    await sendMail({ to: channel.to, subject, html: emailHtml(htmlLines) })
  } catch (err) {
    console.error('[payout-notify] send failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

const e = escapeHtml

/** Email every super admin that an agent requested a manual withdrawal. Best-effort. */
export async function notifySuperAdminsAgentWithdrawal(
  client: Client,
  input: { agentName: string; amountNaira: number; ref: string },
): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production') return
    const admins = await client.superAdmin.findMany({
      where: { email: { not: '' } },
      select: { email: true },
    })
    const html = emailHtml([
      'An agent has requested a withdrawal that needs manual payout.',
      `Agent: <strong>${e(input.agentName)}</strong><br/>` +
        `Amount: <strong>${e(formatNaira(input.amountNaira))}</strong><br/>` +
        `Reference: <code>${e(input.ref)}</code>`,
      'Open the admin dashboard to review it.',
    ])
    for (const a of admins) {
      if (!a.email) continue
      try {
        await sendMail({ to: a.email, subject: 'Agent withdrawal awaiting payout', html })
      } catch {
        // one failed recipient must not stop the others
      }
    }
  } catch (err) {
    console.error('[payout-notify] admin notify failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

export async function notifyAgentPayoutPaid(
  agent: Contact,
  input: { amountNaira: number; ref: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    'Your withdrawal has been paid',
    `Vochus Easy Save: your withdrawal of ${amt} has been paid. Ref ${input.ref}.`,
    [`Your withdrawal of <strong>${e(amt)}</strong> has been paid.`, `Reference: <code>${e(input.ref)}</code>`],
  )
}

export async function notifyAgentPayoutDeclined(
  agent: Contact,
  input: { amountNaira: number; ref: string; reason: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    'Your withdrawal was declined',
    `Vochus Easy Save: your withdrawal of ${amt} was declined. Reason: ${input.reason}. Ref ${input.ref}.`,
    [
      `Your withdrawal of <strong>${e(amt)}</strong> was declined.`,
      `Reason: ${e(input.reason)}`,
      `Reference: <code>${e(input.ref)}</code>`,
    ],
  )
}

export async function notifyAgentRedemptionToReview(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    'Customer redemption under review',
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} is awaiting review. Ref ${input.ref}.`,
    [
      `Your customer <strong>${e(input.customerName)}</strong> requested a redemption of <strong>${e(amt)}</strong>. It is awaiting review.`,
      `Reference: <code>${e(input.ref)}</code>`,
    ],
  )
}

export async function notifyAgentRedemptionPaid(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    'Customer redemption paid',
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} has been paid. Ref ${input.ref}.`,
    [
      `Your customer <strong>${e(input.customerName)}</strong> has been paid <strong>${e(amt)}</strong>.`,
      `Reference: <code>${e(input.ref)}</code>`,
    ],
  )
}

export async function notifyAgentRedemptionDeclined(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string; reason: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    'Customer redemption declined',
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} was declined. Reason: ${input.reason}. Ref ${input.ref}.`,
    [
      `The redemption of <strong>${e(amt)}</strong> for your customer <strong>${e(input.customerName)}</strong> was declined.`,
      `Reason: ${e(input.reason)}`,
      `Reference: <code>${e(input.ref)}</code>`,
    ],
  )
}

export async function notifyCustomerRedemptionPaid(
  customer: Contact,
  type: CustomerType,
  input: { amountNaira: number; ref: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    customerNotifyChannel(customer, type),
    'Your redemption has been paid',
    `Vochus Easy Save: your redemption of ${amt} has been paid. Ref ${input.ref}.`,
    [`Your redemption of <strong>${e(amt)}</strong> has been paid.`, `Reference: <code>${e(input.ref)}</code>`],
  )
}

export async function notifyCustomerRedemptionDeclined(
  customer: Contact,
  type: CustomerType,
  input: { amountNaira: number; ref: string; reason: string },
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    customerNotifyChannel(customer, type),
    'Your redemption was declined',
    `Vochus Easy Save: your redemption of ${amt} was declined. Reason: ${input.reason}. Ref ${input.ref}.`,
    [
      `Your redemption of <strong>${e(amt)}</strong> was declined.`,
      `Reason: ${e(input.reason)}`,
      `Reference: <code>${e(input.ref)}</code>`,
    ],
  )
}
