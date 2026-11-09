// Reminders for money left in a plan that has ended (owner's ask, Nov 2026).
//
// A plan is "uncollected" while it is still Active, past its end date and holding money, with no collection in
// progress. Collecting it (status changes) or rolling it over (new end date) stops the reminders on their own.
//   customer: the end day's in-app notice is planEnded (already sent by the sweep); then a reminder every 7 days.
//             An email goes with the end-day notice and each reminder, when they have a confirmed address with alerts on.
//   agent:    once a week, one notice with the count and total, and an email listing the customers.
// No SMS (owner's cost rule). Run nightly from the notification sweep; every send is deduped, so re-runs are safe.
import type { PrismaClient } from '@prisma/client'
import { notifications as N, notify, type NotificationEvent } from '@/lib/notifications'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { alertEmailFor, agentAlertEmailFor } from '@/lib/email-alerts'
import { renderEmail } from '@/lib/email-template'
import { sendMail } from '@/lib/mail'
import { displayName, formatDate, formatNaira } from '@/lib/format'
import { isoWeekKey } from '@/lib/weekly-summary'

const DAY = 24 * 60 * 60 * 1000
const EMAIL_KIND = 'uncollected_reminder'
const AGENT_LIST_MAX = 25

export type UncollectedPlan = {
  id: string; goal: string; balance: number; maturityDate: Date
  customerId: string; agentId: string; customerName: string
}

/** Whole weeks since the plan ended: 0 on the end day and the 6 days after, 1 from day 7, and so on. */
export function weeksSinceEnd(maturityDate: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - maturityDate.getTime()) / (7 * DAY)))
}

/** The in-app notices due now (pure). The end-day notice isn't here: planEnded already covers week 0. */
export function uncollectedEvents(plans: UncollectedPlan[], now: Date): { customer: NotificationEvent[]; agent: NotificationEvent[] } {
  const customer: NotificationEvent[] = []
  const byAgent = new Map<string, { count: number; total: number }>()
  for (const p of plans) {
    const week = weeksSinceEnd(p.maturityDate, now)
    if (week >= 1) customer.push(...N.planUncollected({ planId: p.id, customerId: p.customerId, goal: p.goal, balance: p.balance, week }))
    const a = byAgent.get(p.agentId) ?? { count: 0, total: 0 }
    a.count++
    a.total = Math.round((a.total + p.balance) * 100) / 100
    byAgent.set(p.agentId, a)
  }
  const weekKey = isoWeekKey(now)
  const agent = [...byAgent].flatMap(([agentId, a]) => N.agentUncollected({ agentId, count: a.count, total: a.total, weekKey }))
  return { customer, agent }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
}

/** Keys from `events` that aren't in the table yet. */
async function newKeys(client: PrismaClient, events: NotificationEvent[]): Promise<Set<string>> {
  const keys = events.map(e => e.dedupeKey)
  const have = new Set<string>()
  for (let i = 0; i < keys.length; i += 200) {
    const rows = await client.notification.findMany({ where: { dedupeKey: { in: keys.slice(i, i + 200) } }, select: { dedupeKey: true } })
    rows.forEach(r => have.add(r.dedupeKey))
  }
  return new Set(keys.filter(k => !have.has(k)))
}

async function mail(to: string, subject: string, html: string): Promise<boolean> {
  // sendMail has no environment gate of its own: never email real people from dev or staging.
  if (process.env.NODE_ENV !== 'production') return false
  try {
    await sendMail({ to, subject, html })
    return true
  } catch (e) {
    // Never log the message: SMTP errors can carry the address.
    console.error(`[uncollected] email failed: ${e instanceof Error ? e.name : 'UnknownError'}`)
    return false
  }
}

export async function runUncollectedReminders(client: PrismaClient, now: Date = new Date()): Promise<{ notices: number; emails: number }> {
  const rows = await client.savingsPlan.findMany({
    where: { status: 'Active', maturityDate: { lte: now }, balance: { gt: 0.009 } },
    select: {
      id: true, goal: true, balance: true, maturityDate: true,
      customer: { select: { id: true, agentId: true, firstName: true, lastName: true, email: true, emailVerifiedAt: true, emailAlertsOn: true } },
    },
  })
  const open: typeof rows = []
  for (const r of rows) if (!(await hasOpenRedemption(client, r.id, now))) open.push(r)

  const plans: UncollectedPlan[] = open.map(r => ({
    id: r.id, goal: r.goal, balance: r.balance, maturityDate: r.maturityDate,
    customerId: r.customer.id, agentId: r.customer.agentId, customerName: `${r.customer.firstName} ${r.customer.lastName}`,
  }))
  const events = uncollectedEvents(plans, now)

  // Only notices not written before; the agent email goes out only with a new weekly notice.
  const fresh = [...events.customer, ...events.agent]
  const toWrite = await newKeys(client, fresh)
  await notify(client, fresh.filter(e => toWrite.has(e.dedupeKey)))
  let emails = 0

  // Customer email: one per plan per week since it ended (week 0 = the end day), claimed first so a re-run can't resend.
  for (const r of open) {
    const to = alertEmailFor(r.customer)
    if (!to) continue
    const week = weeksSinceEnd(r.maturityDate, now)
    try {
      await client.notificationLog.create({ data: { customerId: r.customer.id, kind: EMAIL_KIND, periodKey: `${r.id}:w${week}` } })
    } catch (e) {
      if (isUniqueViolation(e)) continue
      throw e
    }
    const html = renderEmail({
      subject: `Your ${r.goal} plan has ended. Your money is waiting`,
      preheader: `${formatNaira(r.balance)} is ready to redeem.`,
      tone: 'warning',
      statusLabel: 'Ready to redeem',
      heading: `Hi ${displayName(r.customer.firstName)}, your money is waiting`,
      intro: `Your ${r.goal} plan ended on ${formatDate(r.maturityDate)} and still has money in it.`,
      amount: formatNaira(r.balance),
      amountLabel: 'In your plan',
      rows: [['Plan', r.goal], ['Ended on', formatDate(r.maturityDate)]],
      note: 'Open the Vochus Easy Save app to redeem it, or keep saving into the plan again from Home. Your agent can help too.',
    })
    if (await mail(to, `Your ${r.goal} plan has ended. Your money is waiting`, html)) emails++
  }

  // Agent email: once a week, with the list.
  const newAgents = events.agent.filter(e => toWrite.has(e.dedupeKey)).map(e => e.recipient.id)
  if (newAgents.length) {
    const agents = await client.agent.findMany({ where: { id: { in: newAgents } }, select: { id: true, name: true, email: true, emailVerified: true, emailAlertsOn: true } })
    for (const a of agents) {
      const to = agentAlertEmailFor(a)
      if (!to) continue
      const mine = plans.filter(p => p.agentId === a.id).sort((x, y) => x.maturityDate.getTime() - y.maturityDate.getTime())
      const total = Math.round(mine.reduce((s, p) => s + p.balance, 0) * 100) / 100
      const shown = mine.slice(0, AGENT_LIST_MAX)
      const more = mine.length - shown.length
      const html = renderEmail({
        subject: 'Customers who haven’t redeemed their money',
        preheader: `${mine.length} customer${mine.length === 1 ? '' : 's'}, ${formatNaira(total)} waiting.`,
        tone: 'warning',
        statusLabel: 'Weekly list',
        heading: `Hi ${displayName(a.name)}, these customers haven’t redeemed yet`,
        intro: 'Their plans have ended but the money is still in them. A quick call can help them redeem or start saving again.',
        amount: formatNaira(total),
        amountLabel: `Waiting, ${mine.length} customer${mine.length === 1 ? '' : 's'}`,
        rows: shown.map(p => [displayName(p.customerName), `${formatNaira(p.balance)} · ${p.goal} · ended ${formatDate(p.maturityDate)}`]),
        note: more > 0 ? `And ${more} more. See them all under Redemptions in the app.` : 'See them under Redemptions in the app.',
      })
      if (await mail(to, 'Customers who haven’t redeemed their money', html)) emails++
    }
  }

  return { notices: toWrite.size, emails }
}
