// Unit test: the notification catalogue — exact wording, who gets what, dedupe keys, and that writing is an idempotent upsert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notifications as N, notify, badgeText, timeLabel } from '../src/lib/notifications'

const rec = { id: 'r1', customerId: 'c1', agentId: 'a1', customerName: 'ngozi eze', amount: 18500 }

test('a saving tells the customer, and the agent only when an online customer paid by transfer', () => {
  const cash = N.savingsReceived({ ref: 'TXN-1', customerId: 'c1', agentId: 'a1', customerName: 'ngozi eze', planGoal: 'School Fees', amount: 2000, onlineTransfer: false })
  assert.equal(cash.length, 1)
  assert.deepEqual(cash[0].recipient, { type: 'customer', id: 'c1' })
  assert.equal(cash[0].title, '₦2,000 saved into School Fees')
  assert.equal(cash[0].dedupeKey, 'saving:TXN-1')
  const online = N.savingsReceived({ ref: 'TXN-2', customerId: 'c1', agentId: 'a1', customerName: 'ngozi eze', planGoal: 'School Fees', amount: 150.1, onlineTransfer: true })
  assert.equal(online.length, 2)
  assert.equal(online[0].title, '₦150.10 saved into School Fees')
  assert.deepEqual(online[1].recipient, { type: 'agent', id: 'a1' })
  assert.equal(online[1].title, 'Ngozi Eze saved ₦150.10 by transfer')
  assert.equal(online[1].dedupeKey, 'saving-agent:TXN-2')
})

test('a saving that paid a platform fee says how much went into the balance', () => {
  const e = N.savingsReceived({ ref: 'TXN-3', customerId: 'c1', agentId: 'a1', customerName: 'x', planGoal: 'Rent', amount: 1000, fee: 75, onlineTransfer: false })[0]
  assert.equal(e.title, '₦1,000 saved into Rent')
  assert.equal(e.body, '₦75 was the platform fee. ₦925 was added to your balance.')
  assert.equal(N.savingsReceived({ ref: 'TXN-4', customerId: 'c1', agentId: 'a1', customerName: 'x', planGoal: 'Rent', amount: 1000, fee: 0, onlineTransfer: false })[0].body, undefined)
})

test('collection steps: requested, approved, paid, declined — customer always, agent where it concerns them', () => {
  const byCustomer = N.collectionRequested({ ...rec, byCustomer: true })
  assert.deepEqual(byCustomer.map(e => [e.recipient.type, e.title]), [
    ['customer', 'Your collection request was sent'],
    ['agent', 'Ngozi Eze wants to collect ₦18,500'],
  ])
  const byAgent = N.collectionRequested({ ...rec, byCustomer: false })
  assert.deepEqual(byAgent.map(e => e.recipient.type), ['customer'])
  assert.equal(N.collectionApproved(rec)[0].title, 'Your collection was approved')
  const paid = N.collectionPaid(rec)
  assert.deepEqual(paid.map(e => e.title), ['₦18,500 has been paid to you', 'Ngozi Eze’s collection of ₦18,500 was paid'])
  assert.equal(paid[0].dedupeKey, 'collection-paid:r1')
  const declined = N.collectionDeclined({ ...rec, reason: 'Balance changed' })
  assert.equal(declined[0].title, 'Your collection request was declined')
  assert.equal(declined[0].body, 'Reason: Balance changed')
  assert.equal(N.collectionDeclined({ ...rec, reason: null })[0].body, undefined)
  assert.deepEqual(N.collectionDeclined({ ...rec, byAgent: true }).map(e => e.recipient.type), ['customer'])
})

test('wallet top-up and withdrawals reach the agent', () => {
  assert.equal(N.walletFunded({ agentId: 'a1', amount: 50000, ref: 'W1' })[0].title, '₦50,000 added to your wallet')
  assert.equal(N.withdrawalPaid({ id: 'w1', agentId: 'a1', amount: 20000 })[0].title, 'Your withdrawal of ₦20,000 was paid')
  const d = N.withdrawalDeclined({ id: 'w1', agentId: 'a1', amount: 20000, reason: 'Wrong account' })[0]
  assert.equal(d.title, 'Your withdrawal of ₦20,000 was declined')
  assert.equal(d.body, 'The money is back in your commission. Reason: Wrong account')
})

test('plan ending, plan ended, agent weekly reminder and new phone', () => {
  const end = new Date(2026, 11, 12)
  assert.equal(N.planEndingSoon({ planId: 'p1', customerId: 'c1', goal: 'School Fees', maturityDate: end })[0].title, 'Your School Fees plan ends on 12 Dec')
  assert.equal(N.planEnded({ planId: 'p1', customerId: 'c1', goal: 'School Fees' })[0].title, 'Your School Fees plan has ended')
  assert.equal(N.agentPlansEndingThisWeek({ agentId: 'a1', count: 1, dayKey: '2026-11-07' })[0].title, '1 customer’s plan ends this week')
  assert.equal(N.agentPlansEndingThisWeek({ agentId: 'a1', count: 3, dayKey: '2026-11-07' })[0].title, '3 customers’ plans end this week')
  assert.equal(N.agentPlansEndingThisWeek({ agentId: 'a1', count: 0, dayKey: '2026-11-07' }).length, 0)
  const phone = N.newPhone({ type: 'customer', id: 'c1', deviceSessionId: 'd1', model: 'Tecno Spark 10' })[0]
  assert.equal(phone.title, 'Your account was opened on a new phone')
  assert.equal(phone.body, 'Tecno Spark 10. If this wasn’t you, call your agent or Vochus straight away.')
})

test('every event links somewhere inside the right app', () => {
  for (const e of [...N.collectionPaid(rec), ...N.walletFunded({ agentId: 'a1', amount: 1, ref: 'x' })]) {
    assert.ok(e.href && e.href.startsWith(e.recipient.type === 'agent' ? '/dashboard' : '/customer'), e.href)
  }
})

test('notify writes each event as an upsert that never overwrites (retries are harmless)', async () => {
  const calls: unknown[] = []
  const client = { notification: { upsert: async (a: unknown) => { calls.push(a); return a } } }
  await notify(client as unknown as Parameters<typeof notify>[0], N.collectionPaid(rec))
  assert.equal(calls.length, 2)
  const first = calls[0] as { where: { dedupeKey: string }; update: object; create: { recipientType: string; recipientId: string; kind: string } }
  assert.deepEqual(first.where, { dedupeKey: 'collection-paid:r1' })
  assert.deepEqual(first.update, {})
  assert.deepEqual([first.create.recipientType, first.create.recipientId, first.create.kind], ['customer', 'c1', 'collection_paid'])
})

test('badge text and time labels', () => {
  assert.equal(badgeText(0), null)
  assert.equal(badgeText(9), '9')
  assert.equal(badgeText(10), '9+')
  const now = new Date(2026, 10, 7, 16, 0)
  assert.equal(timeLabel(new Date(2026, 10, 7, 14, 15), now), 'Today, 2:15 pm')
  assert.equal(timeLabel(new Date(2026, 10, 6, 9, 3), now), 'Yesterday, 9:03 am')
  assert.equal(timeLabel(new Date(2026, 10, 3, 9, 3), now), '3 Nov')
  assert.equal(timeLabel(new Date(2025, 10, 3, 9, 3), now), '3 Nov 2025')
})
