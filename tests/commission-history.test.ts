import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loanCommission,
  repaymentCommission,
  redemptionCommission,
  filterEntries,
  sumCommission,
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
