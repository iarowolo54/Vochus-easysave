import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loanCommission,
  repaymentCommission,
  redemptionCommission,
  filterEntries,
  sumCommission,
  entriesFromLedger,
  mergeHistory,
  summariseByMonth,
  type CommissionEntry,
} from '../src/lib/commission-history'

test('per-source commission math matches what actually credits the balance', () => {
  assert.equal(loanCommission(50000), 500)        // 1% of principal
  assert.equal(repaymentCommission(33600), 168)   // 0.5% of repayment
  assert.equal(redemptionCommission(1000), 600)   // 60% of penalty
})

const E = (p: Partial<CommissionEntry>): CommissionEntry => ({
  id: p.id ?? 'x', date: p.date ?? '2026-06-01T00:00:00.000Z', source: p.source ?? 'loan',
  commission: p.commission ?? 100, baseAmount: p.baseAmount ?? 1000,
  customerId: p.customerId ?? null, customerName: p.customerName ?? null,
  planGoal: p.planGoal ?? null, ref: p.ref ?? null, status: p.status ?? null,
})

test('filterEntries: date range is inclusive on both ends', () => {
  const rows = [E({ id: 'a', date: '2026-05-01T00:00:00.000Z' }), E({ id: 'b', date: '2026-06-15T00:00:00.000Z' }), E({ id: 'c', date: '2026-07-20T00:00:00.000Z' })]
  const out = filterEntries(rows, { from: '2026-06-01', to: '2026-07-01' })
  assert.deepEqual(out.map(e => e.id), ['b'])
})

test('filterEntries: source subset', () => {
  const rows = [E({ id: 'a', source: 'loan' }), E({ id: 'b', source: 'reward' }), E({ id: 'c', source: 'redemption' })]
  assert.deepEqual(filterEntries(rows, { sources: ['reward', 'redemption'] }).map(e => e.id).sort(), ['b', 'c'])
})

test('filterEntries: search matches customer name or id, case-insensitive', () => {
  const rows = [E({ id: 'a', customerName: 'Ada Obi', customerId: 'CUST01' }), E({ id: 'b', customerName: 'Bola', customerId: 'CUST02' })]
  assert.deepEqual(filterEntries(rows, { q: 'ada' }).map(e => e.id), ['a'])
  assert.deepEqual(filterEntries(rows, { q: 'cust02' }).map(e => e.id), ['b'])
  assert.deepEqual(filterEntries(rows, { q: 'nope' }).map(e => e.id), [])
})

test('filterEntries: status filter', () => {
  const rows = [E({ id: 'a', status: 'Done' }), E({ id: 'b', status: 'Pending' })]
  assert.deepEqual(filterEntries(rows, { status: 'Done' }).map(e => e.id), ['a'])
})

test('filterEntries: no filters returns all; empty values ignored', () => {
  const rows = [E({ id: 'a' }), E({ id: 'b' })]
  assert.equal(filterEntries(rows, {}).length, 2)
  assert.equal(filterEntries(rows, { q: '', from: '', to: '', sources: [] }).length, 2)
})

test('sumCommission totals the commission field (rounded)', () => {
  assert.equal(sumCommission([E({ commission: 500 }), E({ commission: 168 }), E({ commission: 600 })]), 1268)
})

const L = (p: Partial<Parameters<typeof entriesFromLedger>[0][number]>) => ({
  id: p.id ?? 'l1', source: p.source ?? 'savings', sourceRef: p.sourceRef ?? 'TXN-1', base: p.base ?? 1000, amount: p.amount ?? 4,
  createdAt: p.createdAt ?? new Date('2026-11-12T10:00:00Z'), customerId: p.customerId ?? null,
})

test('entriesFromLedger maps the fee sources to the drawer\'s sources and keeps the stored amount', () => {
  const out = entriesFromLedger([
    L({ id: 'a', source: 'daily_first' }), L({ id: 'b', source: 'periodic_fee' }), L({ id: 'c', source: 'settle_up', sourceRef: 'RED-1' }),
    L({ id: 'd', source: 'redemption_fee', sourceRef: 'RED-2' }), L({ id: 'e', source: 'loan', sourceRef: 'DSB-1' }), L({ id: 'f', source: 'repayment', sourceRef: 'RPY-1' }),
  ], new Map())
  assert.deepEqual(out.map(e => e.source), ['savings', 'savings', 'redemption', 'redemption', 'loan', 'repayment'])
  assert.equal(out[0].commission, 4)
  assert.equal(out[0].ref, 'TXN-1')
})

test('mergeHistory drops a reconstructed entry the ledger already has, and keeps the rest', () => {
  const ledger = entriesFromLedger([L({ source: 'loan', sourceRef: 'DSB-1', amount: 500 })], new Map())
  const rec = [E({ id: 'old1', source: 'loan', ref: 'DSB-1' }), E({ id: 'old2', source: 'loan', ref: 'DSB-0' })]
  assert.deepEqual(mergeHistory(ledger, rec).map(e => e.id).sort(), ['l1', 'old2'].sort())
})

test('mergeHistory does not treat a loan and a repayment with the same ref as the same event', () => {
  const ledger = entriesFromLedger([L({ source: 'loan', sourceRef: 'X-1' })], new Map())
  assert.equal(mergeHistory(ledger, [E({ id: 'r', source: 'repayment', ref: 'X-1' })]).length, 2)
})

test('summariseByMonth: real earnings per month, current month always first', () => {
  const entry = (date: string, source: CommissionEntry['source'], commission: number): CommissionEntry => ({
    id: date + source, date, source, commission, baseAmount: 0, customerId: null, customerName: null, planGoal: null, ref: null, status: 'Done',
  })
  const now = new Date(2026, 10, 10)
  const months = summariseByMonth([
    entry(new Date(2026, 10, 2).toISOString(), 'savings', 100.1),
    entry(new Date(2026, 10, 3).toISOString(), 'savings', 0.2),
    entry(new Date(2026, 10, 4).toISOString(), 'reward', 500),
    entry(new Date(2026, 8, 4).toISOString(), 'redemption', 60),
  ], now)
  assert.deepEqual(months.map(m => [m.year, m.month, m.total]), [[2026, 11, 600.3], [2026, 9, 60]])
  assert.equal(months[0].bySource.savings, 100.3)
  assert.deepEqual(summariseByMonth([], now).map(m => [m.month, m.total]), [[11, 0]])
})
