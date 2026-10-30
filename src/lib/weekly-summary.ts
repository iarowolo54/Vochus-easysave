// Pure weekly-summary builder: no DB, no network, no sending.
import { money } from '@/lib/wallet-guard'
import { emailLogo } from '@/lib/email-brand'

const DAY_MS = 24 * 60 * 60 * 1000

export interface WeeklySummaryPlan {
  balance: number
  maturityDate: Date
  interestAccrued: number
  status: string
}

export interface WeeklySummaryInput {
  firstName: string
  plans: WeeklySummaryPlan[]
  weekDeposits: { amount: number }[]
  asOf: Date
}

export interface WeeklySummary {
  savedThisWeek: number
  totalBalance: number
  interestEarned: number
  emailHtml: string
  smsText: string
}

/** ISO-8601 week key (UTC), e.g. 2026-W44. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7 // Mon=1 .. Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum) // Thursday of this week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function weekWindow(asOf: Date): { start: Date; end: Date } {
  return { start: new Date(asOf.getTime() - 7 * DAY_MS), end: new Date(asOf.getTime()) }
}

function fmt(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const active = input.plans.filter((p) => p.status === 'Active')
  const savedThisWeek = money(input.weekDeposits.reduce((s, d) => s + d.amount, 0))
  const totalBalance = money(active.reduce((s, p) => s + p.balance, 0))
  const interestEarned = money(active.reduce((s, p) => s + p.interestAccrued, 0))

  let nearestDays: number | null = null
  for (const p of active) {
    const days = Math.max(0, Math.ceil((p.maturityDate.getTime() - input.asOf.getTime()) / DAY_MS))
    if (nearestDays === null || days < nearestDays) nearestDays = days
  }

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#555">${label}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${value}</td></tr>`
  const maturityRow =
    nearestDays === null
      ? ''
      : row('Next plan matures in', `${nearestDays} day${nearestDays === 1 ? '' : 's'}`)

  const emailHtml =
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px">` +
    `${emailLogo()}` +
    `<h2 style="margin:16px 0 8px">Hi ${escapeHtml(input.firstName)}, here is your week</h2>` +
    `<table style="width:100%;border-collapse:collapse">` +
    row('Saved this week', `&#8358;${fmt(savedThisWeek)}`) +
    row('Total balance', `&#8358;${fmt(totalBalance)}`) +
    row('Interest earned', `&#8358;${fmt(interestEarned)}`) +
    maturityRow +
    `</table><p style="margin-top:16px">Keep saving!</p></div>`

  const smsText =
    `Vochus: this week you saved NGN ${fmt(savedThisWeek)}. ` +
    `Balance NGN ${fmt(totalBalance)}. Interest earned NGN ${fmt(interestEarned)}. Keep saving!`

  return { savedThisWeek, totalBalance, interestEarned, emailHtml, smsText }
}
