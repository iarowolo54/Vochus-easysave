/** Numbers for the super admin Analytics page. Pure, so it can be tested; the route only fetches rows.
 *  Days are Africa/Lagos (WAT, fixed UTC+1). A deposit's `amount` is the full amount paid in; `feeTaken` came out of it. */
const WAT_MS = 3_600_000
const DAY_MS = 86_400_000
const QUIET_DAYS = 7

export type DepositRow = { createdAt: Date; amount: number; feeTaken: number; customerId: string | null; planId: string | null; agentId?: string | null }
export type LedgerRow = { party: string; source: string; amount: number; createdAt: Date }
export type AgentRow = { id: string; agentId: string; name: string; createdAt: Date }
export type LoanRow = { status: string; principal: number; totalAmount: number; dueDate: Date; repaid: number }
export type OutRow = { kind: 'redemption' | 'withdrawal' | 'loan'; amount: number; at: Date }
export type AnalyticsInput = {
  deposits: DepositRow[] // from the start of the previous period
  customerDates: Date[] // sign-ups from the start of the period
  agentDates: Date[]
  activePlans: { id: string; startDate: Date; source: string }[]
  ledger?: LedgerRow[] // commission ledger rows from the start of the previous period
  activeAgents?: AgentRow[]
  loans?: LoanRow[]
  outflows?: OutRow[] // from the start of the previous period
  days: number
  now?: Date
}
export type Bucket = { start: string; deposits: number; customers: number; agents: number }

const key = (ms: number) => new Date(ms + WAT_MS).toISOString().slice(0, 10)
const startOfWatDay = (ms: number) => Math.floor((ms + WAT_MS) / DAY_MS) * DAY_MS - WAT_MS

export function buildAnalytics({ deposits, customerDates, agentDates, activePlans, ledger = [], activeAgents = [], loans = [], outflows = [], days, now = new Date() }: AnalyticsInput) {
  const t = now.getTime()
  const start = startOfWatDay(t) - (days - 1) * DAY_MS
  const prevStart = start - days * DAY_MS
  const bucketDays = days > 31 ? 7 : 1
  const buckets: Bucket[] = Array.from({ length: Math.ceil(days / bucketDays) }, (_, i) => ({
    start: key(start + i * bucketDays * DAY_MS), deposits: 0, customers: 0, agents: 0,
  }))
  const at = (ms: number) => Math.min(buckets.length - 1, Math.floor((ms - start) / (bucketDays * DAY_MS)))

  let total = 0, count = 0, fees = 0, prevTotal = 0, prevCount = 0
  const savers = new Set<string>()
  const byAgent = new Map<string, { total: number; count: number }>()
  const lastByAgent = new Map<string, number>()
  const recentPlans = new Set<string>() // plans with a deposit in the last QUIET_DAYS days
  const quietFrom = startOfWatDay(t) - (QUIET_DAYS - 1) * DAY_MS
  for (const r of deposits) {
    const ms = r.createdAt.getTime()
    if (ms >= start && ms <= t) {
      total += r.amount; fees += r.feeTaken; count++
      buckets[at(ms)].deposits += r.amount
      if (r.customerId) savers.add(r.customerId)
      if (r.agentId) { const a = byAgent.get(r.agentId) ?? { total: 0, count: 0 }; a.total += r.amount; a.count++; byAgent.set(r.agentId, a) }
    } else if (ms >= prevStart && ms < start) { prevTotal += r.amount; prevCount++ }
    if (ms >= quietFrom && r.planId) recentPlans.add(r.planId)
    if (r.agentId && ms <= t && ms > (lastByAgent.get(r.agentId) ?? 0)) lastByAgent.set(r.agentId, ms)
  }
  let newCustomers = 0, newAgents = 0
  for (const d of customerDates) { const ms = d.getTime(); if (ms >= start && ms <= t) { newCustomers++; buckets[at(ms)].customers++ } }
  for (const d of agentDates) { const ms = d.getTime(); if (ms >= start && ms <= t) { newAgents++; buckets[at(ms)].agents++ } }

  // A plan that began over a week ago and has taken no deposit for a week is "quiet".
  const quiet = activePlans.filter(p => p.startDate.getTime() < quietFrom && !recentPlans.has(p.id)).length
  const bySource = { agent: 0, self: 0 }
  for (const p of activePlans) bySource[p.source === 'self' ? 'self' : 'agent']++

  // What the platform keeps is its own ledger rows; what agents earn is theirs. The two never overlap.
  const earn = { platform: 0, platformPrev: 0, agents: 0, agentsPrev: 0, savingsFees: 0, loanShare: 0 }
  for (const r of ledger) {
    const ms = r.createdAt.getTime()
    const now_ = ms >= start && ms <= t, before = ms >= prevStart && ms < start
    if (!now_ && !before) continue
    if (r.party === 'platform') {
      if (now_) { earn.platform += r.amount; if (r.source === 'loan') earn.loanShare += r.amount; else earn.savingsFees += r.amount } else earn.platformPrev += r.amount
    } else if (r.party === 'agent') { if (now_) earn.agents += r.amount; else earn.agentsPrev += r.amount }
  }

  const names = new Map(activeAgents.map(a => [a.id, a]))
  const topAgents = [...byAgent.entries()]
    .filter(([id]) => names.has(id)).sort((a, b) => b[1].total - a[1].total).slice(0, 5)
    .map(([id, v]) => ({ name: names.get(id)!.name, code: names.get(id)!.agentId, total: Math.round(v.total), count: v.count, share: total > 0 ? Math.round((v.total / total) * 100) : 0 }))
  // Idle: signed up over a week ago and no deposit recorded for them in the last week.
  const settled = activeAgents.filter(a => a.createdAt.getTime() < quietFrom)
  const idle = settled.filter(a => !((lastByAgent.get(a.id) ?? 0) >= quietFrom))
    .map(a => ({ name: a.name, code: a.agentId, lastDeposit: lastByAgent.has(a.id) ? new Date(lastByAgent.get(a.id)!).toISOString() : null }))
    .sort((a, b) => (a.lastDeposit ?? '').localeCompare(b.lastDeposit ?? ''))

  // Loans are the whole book, not the period: what is owed, what has come back, what is late.
  let outstanding = 0, principalOut = 0, overdue = 0, overdueCount = 0, totalDue = 0, totalRepaid = 0, pending = 0
  for (const l of loans) {
    if (l.status === 'Pending') { pending++; continue }
    if (l.status !== 'Disbursed' && l.status !== 'Repaid') continue
    totalDue += l.totalAmount; totalRepaid += Math.min(l.repaid, l.totalAmount)
    if (l.status === 'Disbursed') {
      const left = Math.max(0, l.totalAmount - l.repaid)
      outstanding += left; principalOut += l.principal
      if (l.dueDate.getTime() < t && left > 0) { overdue += left; overdueCount++ }
    }
  }

  const out = { total: 0, prevTotal: 0, redemptions: 0, withdrawals: 0, loans: 0 }
  for (const o of outflows) {
    const ms = o.at.getTime()
    if (ms >= start && ms <= t) { out.total += o.amount; if (o.kind === 'redemption') out.redemptions += o.amount; else if (o.kind === 'withdrawal') out.withdrawals += o.amount; else out.loans += o.amount }
    else if (ms >= prevStart && ms < start) out.prevTotal += o.amount
  }

  return {
    earnings: { platform: Math.round(earn.platform), platformPrev: Math.round(earn.platformPrev), agents: Math.round(earn.agents), savingsFees: Math.round(earn.savingsFees), loanShare: Math.round(earn.loanShare) },
    topAgents,
    idleAgents: { count: idle.length, of: settled.length, days: QUIET_DAYS, list: idle.slice(0, 8) },
    loans: { outstanding: Math.round(outstanding), principalOut: Math.round(principalOut), overdue: Math.round(overdue), overdueCount, pending, totalDue: Math.round(totalDue), totalRepaid: Math.round(totalRepaid), repaidPct: totalDue > 0 ? Math.round((totalRepaid / totalDue) * 100) : null },
    out: { total: Math.round(out.total), prevTotal: Math.round(out.prevTotal), redemptions: Math.round(out.redemptions), withdrawals: Math.round(out.withdrawals), loans: Math.round(out.loans), net: Math.round(total - out.total) },
    days, bucketDays, buckets,
    deposits: { total: Math.round(total), count, fees: Math.round(fees), prevTotal: Math.round(prevTotal), prevCount, average: count ? Math.round(total / count) : 0 },
    savers: { active: savers.size, activePlans: activePlans.length, quiet, quietDays: QUIET_DAYS },
    growth: { newCustomers, newAgents },
    plansBySource: bySource,
  }
}
