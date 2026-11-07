import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { renderEmail, type EmailContent } from '@/lib/email-template'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import type { CustomerType } from '@/lib/customer-type'

type Client = Pick<PrismaClient, 'superAdmin'>
type Contact = { email: string | null; phone: string }
type Channel = { via: 'email'; to: string } | { via: 'sms'; to: string }

/** Cap a free-text reason so one declined SMS can't balloon into several billable segments. */
function capReason(reason: string): string {
  return reason.length > 120 ? `${reason.slice(0, 119)}…` : reason
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

/** Optional extras that make a payout email a full record. Anything left out is simply not shown. */
export type PayoutDetail = {
  planGoal?: string | null
  balanceNaira?: number
  feeNaira?: number
  method?: string | null
  bankName?: string | null
  /** Full account number; only the last four digits are ever put in an email. */
  accountNumber?: string | null
  accountName?: string | null
  at?: Date
}

const last4 = (n?: string | null) => (n && n.length >= 4 ? `•••• ${n.slice(-4)}` : null)

function detailRows(input: { ref: string } & PayoutDetail, extra: [string, string | null | undefined][] = []): [string, string | null | undefined][] {
  const bank = input.bankName ? `${input.bankName}${last4(input.accountNumber) ? ` ${last4(input.accountNumber)}` : ''}` : null
  const when = input.at ?? new Date()
  return [
    ...extra,
    ['Plan', input.planGoal],
    ['Plan balance', input.balanceNaira != null ? formatNaira(input.balanceNaira) : null],
    ['Fee taken', input.feeNaira ? formatNaira(input.feeNaira) : null],
    ['Paid by', input.method],
    ['Paid to', bank],
    ['Account name', input.accountName],
    ['Date', `${formatDate(when)}, ${formatTime(when)}`],
    ['Reference', input.ref],
  ]
}

/**
 * Dispatch over the chosen channel. sendMail has no environment gate, so email only goes out in
 * production; sendSMS self-gates. Never throws.
 */
async function dispatch(channel: Channel, smsText: string, email: EmailContent): Promise<void> {
  try {
    if (channel.via === 'sms') {
      // sms: collection paid/declined: cash customers; online customers and agents only without an email
      await sendSMS(channel.to, smsText)
      return
    }
    if (process.env.NODE_ENV !== 'production') return
    await sendMail({ to: channel.to, subject: email.subject, html: renderEmail(email) })
  } catch (err) {
    console.error('[payout-notify] send failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

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
    const content: EmailContent = {
      subject: 'Agent withdrawal awaiting payout',
      preheader: `${input.agentName} asked to withdraw ${formatNaira(input.amountNaira)}`,
      tone: 'warning',
      statusLabel: 'Needs payout',
      heading: 'An agent asked to withdraw',
      intro: 'This withdrawal needs to be paid manually. Open the admin dashboard to review it.',
      amount: formatNaira(input.amountNaira),
      amountLabel: 'Amount requested',
      rows: [['Agent', input.agentName], ['Reference', input.ref]],
    }
    const html = renderEmail(content)
    for (const a of admins) {
      if (!a.email) continue
      try {
        await sendMail({ to: a.email, subject: content.subject, html })
      } catch (err) {
        // one failed recipient must not stop the others, but don't fail silently
        console.error('[payout-notify] admin recipient send failed:', err instanceof Error ? err.message : 'unknown error')
      }
    }
  } catch (err) {
    console.error('[payout-notify] admin notify failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

export async function notifyAgentPayoutPaid(
  agent: Contact,
  input: { amountNaira: number; ref: string; agentName?: string; transferRef?: string | null } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    `Vochus Easy Save: your withdrawal of ${amt} has been paid. Ref ${input.ref}.`,
    {
      subject: 'Your withdrawal has been paid',
      preheader: `${amt} has been paid out to you`,
      tone: 'success',
      statusLabel: 'Paid',
      heading: input.agentName ? `Your withdrawal is paid, ${input.agentName.split(' ')[0]}` : 'Your withdrawal is paid',
      intro: 'Your commission withdrawal has been paid. Here are the details for your records.',
      amount: amt,
      amountLabel: 'Amount paid',
      rows: detailRows(input, [['Transfer reference', input.transferRef]]),
      note: 'It can take a short while to show in your bank app. If it has not arrived by the end of the next working day, tell us with the reference above.',
    },
  )
}

export async function notifyAgentPayoutDeclined(
  agent: Contact,
  input: { amountNaira: number; ref: string; reason: string; agentName?: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    `Vochus Easy Save: your withdrawal of ${amt} was declined. Reason: ${capReason(input.reason)}. Ref ${input.ref}.`,
    {
      subject: 'Your withdrawal was declined',
      preheader: `Your withdrawal of ${amt} was declined and the money is back in your commission balance`,
      tone: 'danger',
      statusLabel: 'Declined',
      heading: 'Your withdrawal was declined',
      intro: 'We could not pay this withdrawal. The money is back in your commission balance.',
      amount: amt,
      amountLabel: 'Amount returned to your balance',
      rows: [['Reason', input.reason], ...detailRows({ ref: input.ref, at: input.at })],
      note: 'You can ask for a new withdrawal once the reason above is sorted out.',
    },
  )
}

export async function notifyAgentRedemptionToReview(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} is awaiting review. Ref ${input.ref}.`,
    {
      subject: 'Customer redemption under review',
      preheader: `${input.customerName} asked to redeem ${amt}`,
      tone: 'warning',
      statusLabel: 'Under review',
      heading: 'A customer asked to redeem',
      intro: `${input.customerName} asked to redeem their savings. It is being reviewed and you will hear again when it is decided.`,
      amount: amt,
      amountLabel: 'Amount requested',
      rows: detailRows(input, [['Customer', input.customerName]]),
    },
  )
}

export async function notifyAgentRedemptionPaid(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} has been paid. Ref ${input.ref}.`,
    {
      subject: 'Customer redemption paid',
      preheader: `${input.customerName} has been paid ${amt}`,
      tone: 'success',
      statusLabel: 'Paid',
      heading: 'Your customer has been paid',
      intro: `${input.customerName}'s redemption has been paid and their plan is closed.`,
      amount: amt,
      amountLabel: 'Amount paid',
      rows: detailRows(input, [['Customer', input.customerName]]),
    },
  )
}

export async function notifyAgentRedemptionDeclined(
  agent: Contact,
  input: { customerName: string; amountNaira: number; ref: string; reason: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    agentNotifyChannel(agent),
    `Vochus Easy Save: ${input.customerName}'s redemption of ${amt} was declined. Reason: ${capReason(input.reason)}. Ref ${input.ref}.`,
    {
      subject: 'Customer redemption declined',
      preheader: `${input.customerName}'s redemption of ${amt} was declined`,
      tone: 'danger',
      statusLabel: 'Declined',
      heading: 'A redemption was declined',
      intro: `${input.customerName}'s redemption was not paid. Their savings stay on the plan.`,
      amount: amt,
      amountLabel: 'Amount requested',
      rows: [['Customer', input.customerName], ['Reason', input.reason], ...detailRows({ ref: input.ref, planGoal: input.planGoal, at: input.at })],
    },
  )
}

export async function notifyCustomerRedemptionPaid(
  customer: Contact,
  type: CustomerType,
  input: { amountNaira: number; ref: string; firstName?: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    customerNotifyChannel(customer, type),
    `Vochus Easy Save: your redemption of ${amt} has been paid. Ref ${input.ref}.`,
    {
      subject: 'Your redemption has been paid',
      preheader: `${amt} has been paid to you`,
      tone: 'success',
      statusLabel: 'Paid',
      heading: input.firstName ? `Your money is on its way, ${input.firstName}` : 'Your redemption is paid',
      intro: 'Your redemption has been paid and your plan is now closed. Here are the details for your records.',
      amount: amt,
      amountLabel: 'Amount paid to you',
      rows: detailRows(input),
      note: 'Bank transfers can take a short while to show in your bank app. If it has not arrived by the end of the next working day, contact your agent with the reference above.',
    },
  )
}

export async function notifyCustomerRedemptionDeclined(
  customer: Contact,
  type: CustomerType,
  input: { amountNaira: number; ref: string; reason: string; firstName?: string } & PayoutDetail,
): Promise<void> {
  const amt = formatNaira(input.amountNaira)
  await dispatch(
    customerNotifyChannel(customer, type),
    `Vochus Easy Save: your redemption of ${amt} was declined. Reason: ${capReason(input.reason)}. Ref ${input.ref}.`,
    {
      subject: 'Your redemption was declined',
      preheader: `Your redemption of ${amt} was declined. Your savings are safe.`,
      tone: 'danger',
      statusLabel: 'Declined',
      heading: input.firstName ? `We could not pay this out, ${input.firstName}` : 'Your redemption was declined',
      intro: 'Your redemption was not paid. Your savings are safe and stay on your plan.',
      amount: amt,
      amountLabel: 'Amount requested',
      rows: [['Reason', input.reason], ...detailRows({ ref: input.ref, planGoal: input.planGoal, at: input.at })],
      note: 'You can ask again once the reason above is sorted out. Your agent can help.',
    },
  )
}
