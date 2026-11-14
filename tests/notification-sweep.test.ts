// Unit test: the nightly safety net builds the SAME notifications (same dedupe keys) as the live paths, so it only ever
// fills gaps; a Bulk Savings batch is one notification; time-based notices only for plans still open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillEvents, scheduledEvents, BULK_NOTE_PREFIX } from '../src/lib/notification-sweep'

const cust = { id: 'c1', agentId: 'a1', firstName: 'Ngozi', lastName: 'Eze' }
const SINCE = new Date(2026, 10, 6)
const plan = (over = {}) => ({ id: 'p1', goal: 'School Fees', source: 'agent', customer: cust, ...over })

test('single savings map to the live key; an online transfer also tells the agent', () => {
  const ev = backfillEvents({
    savings: [
      { ref: 'TXN-1', amount: 500, feeTaken: 0, method: 'Cash', note: null, createdAt: new Date(2026, 10, 7), plan: plan() },
      { ref: 'MP-9', amount: 2000, feeTaken: 0, method: 'Transfer', note: null, createdAt: new Date(2026, 10, 7), plan: plan({ source: 'self' }) },
    ],
    collections: [], withdrawals: [], topUps: [],
  }, { since: SINCE })
  assert.deepEqual(ev.map(e => e.dedupeKey), ['saving:TXN-1', 'saving:MP-9', 'saving-agent:MP-9'])
})

test('a Bulk Savings batch is one notification, keyed on its batch ref, with the amounts and fees added up', () => {
  const note = `${BULK_NOTE_PREFIX}TXN-20`
  const ev = backfillEvents({
    savings: [
      { ref: 'TXN-20', createdAt: new Date(2026, 10, 7), amount: 300, feeTaken: 300, method: 'Cash', note, plan: plan() },
      { ref: 'TXN-21', createdAt: new Date(2026, 10, 7), amount: 300, feeTaken: 0, method: 'Cash', note, plan: plan() },
      { ref: 'TXN-22', createdAt: new Date(2026, 10, 7), amount: 300, feeTaken: 0, method: 'Cash', note, plan: plan() },
    ],
    collections: [], withdrawals: [], topUps: [],
  }, { since: SINCE })
  assert.equal(ev.length, 1)
  assert.equal(ev[0].dedupeKey, 'saving:TXN-20')
  assert.equal(ev[0].title, '₦900 saved into School Fees')
  assert.equal(ev[0].body, '₦300 was the platform fee. ₦600 was added to your balance.')
})

test('collections: who asked decides whether the agent was told; decided rows give paid or declined', () => {
  const base = { savingsPlan: { customer: cust }, netPayout: 1000, agentApprovedAt: null, decidedAt: null, decidedBy: null, status: 'Pending', requestedAt: new Date(2026, 10, 7) }
  const ev = backfillEvents({
    savings: [], withdrawals: [], topUps: [],
    collections: [
      { ...base, id: 'r1', ref: 'RED-CST-1-1' },
      { ...base, id: 'r2', ref: 'AGT-REQ-X' },
      { ...base, id: 'r3', ref: 'ER-1', status: 'Approved', decidedAt: new Date(2026, 10, 7), agentApprovedAt: new Date(2026, 10, 7) },
      { ...base, id: 'r4', ref: 'RED-2', status: 'Rejected', decidedAt: new Date(2026, 10, 7), decidedBy: 'AGT-00142' },
      { ...base, id: 'r5', ref: 'RED-3', requestedAt: new Date(2026, 9, 20), status: 'Approved', decidedAt: new Date(2026, 10, 7) },
    ],
  }, { since: SINCE, agentCodes: new Map([['a1', 'AGT-00142']]) })
  const keys = ev.map(e => e.dedupeKey)
  assert.ok(keys.includes('collection-requested:r1') && keys.includes('collection-wanted:r1'))
  assert.ok(keys.includes('collection-requested:r2') && !keys.includes('collection-wanted:r2'))
  assert.ok(keys.includes('collection-approved:r3') && keys.includes('collection-paid:r3') && keys.includes('collection-paid-agent:r3'))
  assert.ok(keys.includes('collection-declined:r4'))
  assert.ok(!keys.includes('collection-declined-agent:r4'), 'the agent declined it themselves')
  assert.ok(keys.includes('collection-paid:r5') && !keys.includes('collection-requested:r5'), 'an old request is not announced after it was paid')
  assert.equal(ev.find(e => e.dedupeKey === 'collection-paid:r5')?.at?.getTime(), new Date(2026, 10, 7).getTime(), 'carries the real event time')
})

test('withdrawals and top-ups', () => {
  const ev = backfillEvents({
    savings: [], collections: [],
    withdrawals: [
      { id: 'w1', agentId: 'a1', amount: 5000, status: 'Approved', adminNote: null, decidedAt: new Date(2026, 10, 7) },
      { id: 'w2', agentId: 'a1', amount: 5000, status: 'Rejected', adminNote: 'Auto-refund: Paystack failed', decidedAt: new Date(2026, 10, 7) },
      { id: 'w3', agentId: 'a1', amount: 5000, status: 'Processing', adminNote: null, decidedAt: new Date(2026, 10, 7) },
    ],
    topUps: [{ ref: 'WF-1', agentId: 'a1', amount: 10000, createdAt: new Date(2026, 10, 7) }],
  }, { since: SINCE })
  assert.deepEqual(ev.map(e => e.dedupeKey), ['withdrawal-paid:w1', 'withdrawal-declined:w2', 'wallet:WF-1'])
  assert.equal(ev[1].body, 'The money is back in your commission. Reason: The bank transfer didn’t go through.')
})

test('scheduled: ending within 7 days, ended, and one daily count per agent', () => {
  const now = new Date(2026, 10, 7, 6)
  const ev = scheduledEvents([
    { id: 'p1', goal: 'Rent', customerId: 'c1', agentId: 'a1', maturityDate: new Date(2026, 10, 12) },
    { id: 'p2', goal: 'Fees', customerId: 'c2', agentId: 'a1', maturityDate: new Date(2026, 10, 10) },
    { id: 'p3', goal: 'Shop', customerId: 'c3', agentId: 'a2', maturityDate: new Date(2026, 10, 5) },
    { id: 'p4', goal: 'Far', customerId: 'c4', agentId: 'a2', maturityDate: new Date(2026, 11, 30) },
  ], now)
  const keys = ev.map(e => e.dedupeKey)
  assert.ok(keys.includes('plan-ending:p1') && keys.includes('plan-ending:p2'))
  assert.ok(keys.includes('plan-ended:p3'))
  assert.ok(!keys.some(k => k.endsWith(':p4')))
  assert.ok(keys.includes('plans-ending:a1:2026-11-07'))
  assert.ok(!keys.some(k => k.startsWith('plans-ending:a2')), 'a2 has none ending this week')
  assert.equal(ev.find(e => e.dedupeKey === 'plans-ending:a1:2026-11-07')?.title, '2 customers’ plans end this week')
})

test('backfill: a fee refund rebuilds the customer notice and the agent’s returned share', () => {
  const since = new Date('2026-11-11T00:00:00Z')
  const ev = backfillEvents({
    savings: [], collections: [], withdrawals: [], topUps: [],
    feeRefunds: [{
      ref: 'FRF-1', agentId: 'a1', amount: 500, note: 'Refund of the fee on TXN-9809. Online customer.', createdAt: new Date('2026-11-12T05:00:00Z'), agentShare: 300,
      plan: { goal: 'General Savings', customer: { id: 'c1', agentId: 'a1', firstName: 'Lydia', lastName: 'Ojelade' } },
    }],
  }, { since })
  assert.deepEqual(ev.map(e => e.dedupeKey), ['fee-refund:FRF-1', 'fee-refund-agent:FRF-1'])
  assert.equal(ev[0].at?.toISOString(), '2026-11-12T05:00:00.000Z')
})

test('customer photos: decided rows give approved or rejected to the agent, with the live keys', () => {
  const decidedAt = new Date(Date.now() - 3600e3)
  const events = backfillEvents({
    savings: [], collections: [], withdrawals: [], topUps: [],
    customerPhotos: [
      { id: 'p1', agentId: 'a1', status: 'Approved', decidedAt, customer: { firstName: 'Ada', lastName: 'Obi' } },
      { id: 'p2', agentId: 'a1', status: 'Rejected', decidedAt, customer: { firstName: 'Bola', lastName: 'Ade' } },
      { id: 'p3', agentId: 'a1', status: 'Pending', decidedAt: null, customer: { firstName: 'C', lastName: 'D' } },
    ],
  }, { since: new Date(Date.now() - 48 * 3600e3) })
  assert.deepEqual(events.map(e => e.dedupeKey), ['customer-photo-approved:p1', `customer-photo-rejected:p2:${decidedAt.getTime()}`])
})

test('backfill: an agent-paid deposit into an online plan is rebuilt with who paid it in', () => {
  const ev = backfillEvents({
    savings: [{ ref: 'TXN-1', amount: 2000, feeTaken: 0, method: 'Cash', note: null, createdAt: new Date('2026-11-14T08:00:00Z'), paidByAgentId: 'a1', agent: { name: 'Ilori Olawunmi' },
      plan: { goal: 'General Savings', source: 'self', customer: { id: 'c1', agentId: 'a1', firstName: 'Yetunde', lastName: 'Salau' } } }],
    collections: [], withdrawals: [], topUps: [],
  }, { since: new Date('2026-11-13T00:00:00Z') })
  assert.equal(ev[0].body, 'Paid in by your agent, Ilori Olawunmi.')
})
