// Pure weekly-summary builder: no DB, no network, no sending.
import { money } from '@/lib/wallet-guard'
import { renderEmail } from '@/lib/email-template'
import { formatNaira } from '@/lib/format'

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

export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const active = input.plans.filter((p) => p.status === 'Active')
  const savedThisWeek = money(input.weekDeposits.reduce((s, d) => s + d.amount, 0))
  const totalBalance = money(active.reduce((s, p) => s + p.balance, 0))
  const interestEarned = money(active.reduce((s, p) => s + p.interestAccrued, 0))

  let nearestDays: number | null = null
  for (const p of active) {
    const days = Math.ceil((p.maturityDate.getTime() - input.asOf.getTime()) / DAY_MS)
    if (days <= 0) continue // already ended: it is waiting to be redeemed, so it isn't "next"
    if (nearestDays === null || days < nearestDays) nearestDays = days
  }

  const emailHtml = renderEmail({
    subject: 'Your Vochus weekly savings summary',
    preheader: `You saved ${formatNaira(savedThisWeek)} this week.`,
    tone: 'success',
    statusLabel: '',
    routine: true,
    heading: `Hi ${input.firstName}, here is your week`,
    amount: formatNaira(totalBalance),
    amountLabel: 'Total balance',
    rows: [
      ['Saved this week', formatNaira(savedThisWeek), 'strong'],
      // Cash plans don't earn interest, so a saver with none isn't shown a line of ₦0.
      ['Interest earned', interestEarned > 0 ? formatNaira(interestEarned) : null],
      ['Next plan ends in', nearestDays === null ? null : `${nearestDays} day${nearestDays === 1 ? '' : 's'}`],
    ],
    note: 'Keep saving!',
  })

  const smsText =
    `Vochus: this week you saved NGN ${fmt(savedThisWeek)}. ` +
    `Balance NGN ${fmt(totalBalance)}. ` +
    (interestEarned > 0 ? `Interest earned NGN ${fmt(interestEarned)}. ` : '') +
    'Keep saving!'

  return { savedThisWeek, totalBalance, interestEarned, emailHtml, smsText }
}
