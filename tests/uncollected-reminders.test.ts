import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uncollectedEvents, weeksSinceEnd, type UncollectedPlan } from '../src/lib/uncollected-reminders'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-11-09T06:00:00Z') // a Monday
const ended = (days: number) => new Date(now.getTime() - days * DAY)
const plan = (id: string, agentId: string, days: number, balance: number): UncollectedPlan =>
  ({ id, goal: 'Rent', balance, maturityDate: ended(days), customerId: `c-${id}`, agentId, customerName: 'ada obi' })

test('weeks since end: 0 for the first 6 days, then one more each 7 days', () => {
  assert.equal(weeksSinceEnd(ended(0), now), 0)
  assert.equal(weeksSinceEnd(ended(6.9), now), 0)
  assert.equal(weeksSinceEnd(ended(7), now), 1)
  assert.equal(weeksSinceEnd(ended(15), now), 2)
})

test('customer: no reminder in the first week (planEnded covers the end day), then one per week', () => {
  const ev = uncollectedEvents([plan('p1', 'a1', 3, 5000), plan('p2', 'a1', 7, 2500), plan('p3', 'a1', 21, 100)], now)
  assert.deepEqual(ev.customer.map(e => e.dedupeKey), ['plan-uncollected:p2:w1', 'plan-uncollected:p3:w3'])
  assert.equal(ev.customer[0].title, '₦2,500 is waiting in your Rent plan')
  assert.equal(ev.customer[0].recipient.id, 'c-p2')
})

test('agent: one notice a week with every ended plan, including ones in their first week', () => {
  const ev = uncollectedEvents([plan('p1', 'a1', 3, 5000), plan('p2', 'a1', 7, 2500.5), plan('p3', 'a2', 21, 100)], now)
  const a1 = ev.agent.find(e => e.recipient.id === 'a1')!
  assert.equal(a1.dedupeKey, 'uncollected-agent:a1:2026-W46')
  assert.equal(a1.title, '2 customers haven’t redeemed their money')
  assert.equal(a1.body, '₦7,500.50 is waiting in plans that have ended.')
  assert.equal(ev.agent.find(e => e.recipient.id === 'a2')?.title, '1 customer hasn’t redeemed their money')
})

test('nothing to say, nothing sent', () => {
  assert.deepEqual(uncollectedEvents([], now), { customer: [], agent: [] })
})
