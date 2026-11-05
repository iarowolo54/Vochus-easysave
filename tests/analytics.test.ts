import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalytics } from '../src/lib/analytics'

const now = new Date('2026-11-05T10:00:00Z')
const dep = (iso: string, amount: number, customerId: string, planId: string, feeTaken = 0) => ({ createdAt: new Date(iso), amount, feeTaken, customerId, planId })

test('totals, previous period, savers and quiet plans', () => {
  const a = buildAnalytics({
    days: 7, now,
    deposits: [
      dep('2026-11-05T08:00:00Z', 1000, 'c1', 'p1', 50),
      dep('2026-11-01T08:00:00Z', 500, 'c1', 'p1'),
      dep('2026-11-02T08:00:00Z', 250, 'c2', 'p2'),
      dep('2026-10-28T08:00:00Z', 400, 'c3', 'p3'), // previous 7 days (29 Oct–… starts 23 Oct): inside prev window
      dep('2026-10-10T08:00:00Z', 999, 'c9', 'p9'), // before both windows: ignored
    ],
    customerDates: [new Date('2026-11-04T09:00:00Z'), new Date('2026-10-01T09:00:00Z')],
    agentDates: [new Date('2026-11-05T09:00:00Z')],
    activePlans: [
      { id: 'p1', startDate: new Date('2026-09-01'), source: 'agent' },
      { id: 'p3', startDate: new Date('2026-09-01'), source: 'self' }, // no deposit in last 7 days → quiet
      { id: 'p4', startDate: new Date('2026-11-04'), source: 'agent' }, // started yesterday → not quiet
    ],
  })
  assert.equal(a.deposits.total, 1750)
  assert.equal(a.deposits.count, 3)
  assert.equal(a.deposits.fees, 50)
  assert.equal(a.deposits.prevTotal, 400)
  assert.equal(a.deposits.average, 583)
  assert.equal(a.savers.active, 2)
  assert.equal(a.savers.quiet, 1)
  assert.deepEqual(a.plansBySource, { agent: 2, self: 1 })
  assert.deepEqual(a.growth, { newCustomers: 1, newAgents: 1 })
  assert.equal(a.buckets.length, 7)
  assert.equal(a.buckets[6].deposits, 1000) // today is the last bucket
})

test('90 days is bucketed by week', () => {
  const a = buildAnalytics({ days: 90, now, deposits: [], customerDates: [], agentDates: [], activePlans: [] })
  assert.equal(a.bucketDays, 7)
  assert.equal(a.buckets.length, 13)
})

test('platform keeps its own ledger rows only; agents, idle agents, loans and money out', () => {
  const d = (iso: string) => new Date(iso)
  const a = buildAnalytics({
    days: 7, now,
    deposits: [
      { createdAt: d('2026-11-05T08:00:00Z'), amount: 1000, feeTaken: 0, customerId: 'c1', planId: 'p1', agentId: 'a1' },
      { createdAt: d('2026-11-02T08:00:00Z'), amount: 3000, feeTaken: 0, customerId: 'c2', planId: 'p2', agentId: 'a2' },
    ],
    customerDates: [], agentDates: [], activePlans: [],
    ledger: [
      { party: 'platform', source: 'daily_first', amount: 100, createdAt: d('2026-11-04T08:00:00Z') },
      { party: 'platform', source: 'loan', amount: 40, createdAt: d('2026-11-04T08:00:00Z') },
      { party: 'agent', source: 'daily_first', amount: 150, createdAt: d('2026-11-04T08:00:00Z') },
      { party: 'platform', source: 'daily_first', amount: 70, createdAt: d('2026-10-26T08:00:00Z') }, // previous period
    ],
    activeAgents: [
      { id: 'a1', agentId: 'AG1', name: 'One', createdAt: d('2026-09-01') },
      { id: 'a2', agentId: 'AG2', name: 'Two', createdAt: d('2026-09-01') },
      { id: 'a3', agentId: 'AG3', name: 'Three', createdAt: d('2026-09-01') }, // no deposits: idle
      { id: 'a4', agentId: 'AG4', name: 'Four', createdAt: d('2026-11-04') }, // too new to count
    ],
    loans: [
      { status: 'Disbursed', principal: 1000, totalAmount: 1200, dueDate: d('2026-11-01'), repaid: 200 }, // overdue 1000
      { status: 'Repaid', principal: 500, totalAmount: 600, dueDate: d('2026-10-01'), repaid: 600 },
      { status: 'Pending', principal: 900, totalAmount: 0, dueDate: d('2026-12-01'), repaid: 0 },
    ],
    outflows: [
      { kind: 'redemption', amount: 800, at: d('2026-11-03T08:00:00Z') },
      { kind: 'withdrawal', amount: 200, at: d('2026-11-04T08:00:00Z') },
      { kind: 'loan', amount: 500, at: d('2026-10-26T08:00:00Z') }, // previous period
    ],
  })
  assert.deepEqual(a.earnings, { platform: 140, platformPrev: 70, agents: 150, savingsFees: 100, loanShare: 40 })
  assert.deepEqual(a.topAgents.map(x => [x.code, x.share]), [['AG2', 75], ['AG1', 25]])
  assert.equal(a.idleAgents.count, 1)
  assert.equal(a.idleAgents.list[0].code, 'AG3')
  assert.equal(a.loans.outstanding, 1000)
  assert.equal(a.loans.overdueCount, 1)
  assert.equal(a.loans.repaidPct, Math.round((800 / 1800) * 100))
  assert.equal(a.loans.pending, 1)
  assert.equal(a.out.total, 1000)
  assert.equal(a.out.prevTotal, 500)
  assert.equal(a.out.net, 4000 - 1000)
})
