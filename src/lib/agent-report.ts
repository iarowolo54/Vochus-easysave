import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'

export type AgentReportRow = {
  agentId: string
  name: string
  customersCount: number
  fundsUnderManagement: number
  activePlansCount: number
  commissionBalance: number
  overdueSaversCount: number
}

const OVERDUE_DAYS = 3
const lagosDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

/** One row per agent using a fixed number of grouped queries (no per-agent / per-customer queries). */
export async function buildAgentReport(now = new Date()): Promise<AgentReportRow[]> {
  const [agents, customers, planGroups, paidGroups] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, agentId: true, name: true, commissionBalance: true }, orderBy: { agentId: 'asc' } }),
    prisma.customer.findMany({ select: { id: true, agentId: true } }),
    prisma.savingsPlan.groupBy({
      by: ['customerId'],
      where: { status: 'Active' },
      _sum: { balance: true },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ['customerId'],
      where: { type: 'saving', status: 'Done', customerId: { not: null } },
      _max: { createdAt: true },
    }),
  ])

  const agentOf = new Map(customers.map((c) => [c.id, c.agentId]))
  const customersCount = new Map<string, number>()
  for (const c of customers) customersCount.set(c.agentId, (customersCount.get(c.agentId) ?? 0) + 1)

  const lastPaid = new Map<string, Date>()
  for (const r of paidGroups) if (r.customerId && r._max.createdAt) lastPaid.set(r.customerId, r._max.createdAt)

  const today = Date.parse(lagosDay(now))
  const funds = new Map<string, number>()
  const plans = new Map<string, number>()
  const overdue = new Map<string, number>()
  for (const g of planGroups) {
    const aid = agentOf.get(g.customerId)
    if (!aid) continue
    funds.set(aid, (funds.get(aid) ?? 0) + (g._sum.balance ?? 0))
    plans.set(aid, (plans.get(aid) ?? 0) + g._count._all)
    const last = lastPaid.get(g.customerId)
    if (!last || Math.round((today - Date.parse(lagosDay(last))) / 86_400_000) >= OVERDUE_DAYS) {
      overdue.set(aid, (overdue.get(aid) ?? 0) + 1)
    }
  }

  return agents.map((a) => ({
    agentId: a.agentId,
    name: a.name,
    customersCount: customersCount.get(a.id) ?? 0,
    fundsUnderManagement: money(funds.get(a.id) ?? 0),
    activePlansCount: plans.get(a.id) ?? 0,
    commissionBalance: money(a.commissionBalance),
    overdueSaversCount: overdue.get(a.id) ?? 0,
  }))
}

/** RFC 4180 field escaping. Also neutralises spreadsheet formula injection in text fields. */
export function csvField(v: string | number): string {
  let s = String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const AGENT_REPORT_COLUMNS = [
  'agentId', 'name', 'customersCount', 'fundsUnderManagement', 'activePlansCount', 'commissionBalance', 'overdueSaversCount',
] as const

export function agentReportCsv(rows: AgentReportRow[]): string {
  const lines = [AGENT_REPORT_COLUMNS.join(',')]
  for (const r of rows) lines.push(AGENT_REPORT_COLUMNS.map((c) => csvField(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}
