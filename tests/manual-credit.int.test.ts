// Integration test for crediting bank transfers by hand. Runs against a throwaway COPY of prisma/dev.db (needs the
// UITEST-C1 customer and AGT-UITEST agent that the local dev database ships with), so dev.db itself is not written.
//   npx tsx --test tests/manual-credit.int.test.ts
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { creditRequestByHand, creditAlertByHand, dismissAlert } from '../src/lib/manual-credit'
import { watKey } from '../src/lib/savings-card'

const dir = mkdtempSync(join(tmpdir(), 'manual-credit-'))
const copy = join(dir, 'copy.db')
let db: PrismaClient
let customerId = ''
let planId = ''
let agentId = ''
const admin = { id: 'test-admin', name: 'Test Admin' }
const rid = Math.random().toString(36).slice(2, 8)

before(async () => {
  execFileSync('sqlite3', [join(process.cwd(), 'prisma/dev.db'), `.backup ${copy}`])
  db = new PrismaClient({ datasourceUrl: `file:${copy}` })
  const customer = await db.customer.findFirstOrThrow({ where: { customerId: 'UITEST-C1' } })
  customerId = customer.id
  planId = (await db.savingsPlan.findFirstOrThrow({ where: { customerId, status: 'Active' } })).id
  agentId = (await db.agent.findFirstOrThrow({ where: { agentId: 'AGT-UITEST' } })).id
})

after(async () => {
  await db.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

const newIntent = (ref: string, over: Record<string, unknown>) =>
  db.paymentIntent.create({
    data: { ref, method: 'transfer', amount: 500.01, expiresAt: new Date(Date.now() - 3_600_000), actorType: 'customer', customerId, planId, ...over },
  })

const newAlert = (n: string, amount = 750.02) =>
  db.bankAlert.create({
    data: { messageId: `m-${rid}-${n}`, txnId: `t-${rid}-${n}`, amount, senderName: 'TEST', narration: 'TEST', alertAt: new Date(), status: 'Unmatched' },
  })

test('a customer request is credited once, with a transaction and the staff note', async () => {
  const ref = `VCHS-T-${rid}-1`
  await newIntent(ref, {})
  const before = (await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance

  const first = await creditRequestByHand(db, { ref, admin, note: 'seen in bank app' })
  assert.deepEqual(first, { ok: true, amount: 500.01 })

  const tx = await db.transaction.findUniqueOrThrow({ where: { ref } })
  assert.equal(tx.method, 'Transfer')
  assert.equal(tx.amount, 500.01)
  assert.ok((await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance > before)
  const intent = await db.paymentIntent.findFirstOrThrow({ where: { ref } })
  assert.equal(intent.status, 'Done')
  assert.equal(intent.manualBy, 'Test Admin')
  assert.equal(intent.manualNote, 'seen in bank app')
  // who and why are written with the credit, as an admin-attributed audit row
  const audit = await db.auditLog.findFirst({ where: { action: 'bank_transfer_credited_by_hand', entityId: ref } })
  assert.equal(audit?.actorName, 'Test Admin')

  const again = await creditRequestByHand(db, { ref, admin, note: 'again' })
  assert.equal(again.ok, false)
  assert.equal(again.ok === false && again.status, 409)
})

test('two staff crediting the same request at once credit it once', async () => {
  const ref = `VCHS-T-${rid}-2`
  await newIntent(ref, { amount: 600.03 })
  const results = await Promise.all([
    creditRequestByHand(db, { ref, admin, note: 'staff one' }),
    creditRequestByHand(db, { ref, admin, note: 'staff two' }),
  ])
  assert.equal(results.filter((r) => r.ok).length, 1)
  assert.equal(await db.transaction.count({ where: { ref } }), 1)
})

test('an agent request credits the wallet by the amount shown', async () => {
  const ref = `VCHS-T-${rid}-3`
  await newIntent(ref, { actorType: 'agent', agentId, customerId: null, planId: null, amount: 1000.04 })
  const before = (await db.agent.findUniqueOrThrow({ where: { id: agentId } })).walletBalance
  const r = await creditRequestByHand(db, { ref, admin, note: 'agent paid' })
  assert.equal(r.ok, true)
  const after = (await db.agent.findUniqueOrThrow({ where: { id: agentId } })).walletBalance
  assert.equal(Math.round((after - before) * 100), 100004)
  const wf = await db.transaction.findUniqueOrThrow({ where: { ref } })
  assert.equal(wf.type, 'wallet_funding')
  // the staff's private note stays off the agent's own record
  assert.ok(!wf.note?.includes('agent paid'))
})

test('a held alert is credited to the chosen plan once, then cannot be credited or dismissed', async () => {
  const alert = await newAlert('a')
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId }, admin, note: 'sender named in bank app' })
  assert.deepEqual(r, { ok: true, amount: 750.02 })
  const row = await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })
  assert.equal(row.status, 'Resolved')
  assert.ok(row.intentRef)
  assert.equal((await db.transaction.findUniqueOrThrow({ where: { ref: row.intentRef! } })).amount, 750.02)

  const again = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId }, admin, note: 'dup' })
  assert.equal(again.ok === false && again.status, 409)
  const dismissed = await dismissAlert(db, { alertId: alert.id, admin, note: 'dup' })
  assert.equal(dismissed.ok === false && dismissed.status, 409)
})

test('a plan that is not the customer’s is refused and the alert stays held', async () => {
  const alert = await newAlert('b')
  const other = await db.savingsPlan.findFirstOrThrow({ where: { NOT: { customerId } } })
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: other.id }, admin, note: 'wrong plan' })
  assert.equal(r.ok === false && r.status, 404)
  assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
})

test('a held alert can go to an agent wallet, or be dismissed with a note', async () => {
  const toAgent = await newAlert('c', 2000.05)
  const r = await creditAlertByHand(db, { alertId: toAgent.id, target: { kind: 'agent', agentId }, admin, note: 'agent paid' })
  assert.equal(r.ok, true)

  const toDismiss = await newAlert('d')
  const d = await dismissAlert(db, { alertId: toDismiss.id, admin, note: 'not ours' })
  assert.equal(d.ok, true)
  const row = await db.bankAlert.findUniqueOrThrow({ where: { id: toDismiss.id } })
  assert.equal(row.status, 'Dismissed')
  assert.equal(row.resolvedNote, 'not ours')
})

test('a request is not credited while a held payment of the same amount is waiting', async () => {
  const ref = `VCHS-T-${rid}-4`
  await newIntent(ref, { amount: 901.07 })
  const held = await newAlert('e', 901.07)
  const blocked = await creditRequestByHand(db, { ref, admin, note: 'customer says paid' })
  assert.equal(blocked.ok === false && blocked.status, 409)
  assert.equal(await db.transaction.count({ where: { ref } }), 0)
  // once the held one is dismissed, the request can be credited
  await dismissAlert(db, { alertId: held.id, admin, note: 'checked' })
  assert.equal((await creditRequestByHand(db, { ref, admin, note: 'customer says paid' })).ok, true)
})

test('a failed credit leaves the held payment held and no stray request behind', async () => {
  const alert = await newAlert('f')
  // A plan past its maturity date cannot take money, so the credit fails inside its transaction.
  const plan = await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })
  await db.savingsPlan.update({ where: { id: planId }, data: { maturityDate: new Date(Date.now() - 86_400_000) } })
  try {
    const before = (await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance
    const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId }, admin, note: 'closed plan', ackLookalike: true })
    assert.equal(r.ok, false)
    assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
    assert.equal(await db.paymentIntent.count({ where: { manualNote: 'closed plan', status: 'Done' } }), 0)
    assert.equal((await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance, before)
  } finally {
    await db.savingsPlan.update({ where: { id: planId }, data: { maturityDate: plan.maturityDate } })
  }
})

test('a held payment with the same naira figure (no kobo) blocks crediting the request, and crediting the held money instead works', async () => {
  const ref = `VCHS-T-${rid}-5`
  await newIntent(ref, { amount: 3000.37 })
  const held = await newAlert('g', 3000.0)
  const blocked = await creditRequestByHand(db, { ref, admin, note: 'customer says paid' })
  assert.equal(blocked.ok === false && blocked.status, 409)
  assert.equal(await db.transaction.count({ where: { ref } }), 0)
  // the right move: credit the held money to that customer, at the amount that arrived
  const r = await creditAlertByHand(db, { alertId: held.id, target: { kind: 'customer', customerId, planId }, admin, note: 'sender is this customer' })
  assert.deepEqual(r, { ok: true, amount: 3000 })
})

test('held money with the same naira figure as a recent hand credit needs an explicit acknowledgement', async () => {
  const ref = `VCHS-T-${rid}-6`
  await newIntent(ref, { amount: 4000.37 })
  assert.equal((await creditRequestByHand(db, { ref, admin, note: 'paid, seen in bank app' })).ok, true)

  // the real payment arrives later as a round figure
  const late = await newAlert('h', 4000.0)
  const refused = await creditAlertByHand(db, { alertId: late.id, target: { kind: 'customer', customerId, planId }, admin, note: 'maybe the same' })
  assert.equal(refused.ok === false && refused.status, 409)
  assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: late.id } })).status, 'Unmatched')

  const ok = await creditAlertByHand(db, { alertId: late.id, target: { kind: 'customer', customerId, planId }, admin, note: 'checked: a different sender', ackLookalike: true })
  assert.equal(ok.ok, true)
})

test('a round-up payment is caught too: ₦5,000.99 credited by hand, then ₦5,001.00 arrives', async () => {
  const ref = `VCHS-T-${rid}-7`
  await newIntent(ref, { amount: 5000.99 })
  assert.equal((await creditRequestByHand(db, { ref, admin, note: 'paid, seen in bank app' })).ok, true)
  const late = await newAlert('i', 5001.0)
  const refused = await creditAlertByHand(db, { alertId: late.id, target: { kind: 'customer', customerId, planId }, admin, note: 'maybe the same' })
  assert.equal(refused.ok === false && refused.status, 409)
})

test('crediting held money to a person closes their open request for the same figure', async () => {
  const ref = `VCHS-T-${rid}-8`
  await newIntent(ref, { amount: 6000.37, expiresAt: new Date(Date.now() + 20 * 60_000) })
  const held = await newAlert('j', 6000.0)
  assert.equal((await creditAlertByHand(db, { alertId: held.id, target: { kind: 'customer', customerId, planId }, admin, note: 'sender is this customer' })).ok, true)
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref } })).status, 'Superseded')
  const again = await creditRequestByHand(db, { ref, admin, note: 'paid', ackLookalike: true })
  assert.equal(again.ok === false && again.status, 409)
  assert.equal(await db.transaction.count({ where: { ref } }), 0)
})

test('crediting a request by hand needs a tick when the same figure was credited by hand for someone else', async () => {
  const first = `VCHS-T-${rid}-9`
  const second = `VCHS-T-${rid}-10`
  await newIntent(first, { amount: 7000.37 })
  // a different person (an agent) asks for about the same figure
  await newIntent(second, { actorType: 'agent', agentId, customerId: null, planId: null, amount: 7000.62 })
  assert.equal((await creditRequestByHand(db, { ref: first, admin, note: 'paid, seen in bank app' })).ok, true)
  const refused = await creditRequestByHand(db, { ref: second, admin, note: 'paid too?' })
  assert.equal(refused.ok === false && refused.status, 409)
  assert.equal(await db.transaction.count({ where: { ref: second } }), 0)
  assert.equal((await creditRequestByHand(db, { ref: second, admin, note: 'different person, checked', ackLookalike: true })).ok, true)
})

test('a hand credit made AFTER the held money arrived is flagged, however long after', async () => {
  const ref = `VCHS-T-${rid}-11`
  await newIntent(ref, { amount: 8000.37 })
  assert.equal((await creditRequestByHand(db, { ref, admin, note: 'paid, seen in bank app' })).ok, true)
  // held money that arrived 10 days before that credit: the credit may well have been this money
  const oldAlert = await db.bankAlert.create({
    data: { messageId: `m-${rid}-old`, txnId: `t-${rid}-old`, amount: 8000.0, senderName: 'TEST', narration: 'TEST', alertAt: new Date(Date.now() - 10 * 86_400_000), status: 'Unmatched' },
  })
  const refused = await creditAlertByHand(db, { alertId: oldAlert.id, target: { kind: 'customer', customerId, planId }, admin, note: 'old payment' })
  assert.equal(refused.ok === false && refused.status, 409)
})

test('a hand credit made long BEFORE the held money arrived is not a lookalike', async () => {
  const ref = `VCHS-T-${rid}-12`
  await db.paymentIntent.create({
    data: { ref, method: 'transfer', amount: 9000.37, actorType: 'customer', customerId, planId, status: 'Done', manualBy: 'Test Admin', manualNote: 'an old one',
      consumedAt: new Date(Date.now() - 20 * 86_400_000), createdAt: new Date(Date.now() - 20 * 86_400_000), expiresAt: new Date(Date.now() - 20 * 86_400_000) },
  })
  const fresh = await newAlert('k', 9000.0)
  const ok = await creditAlertByHand(db, { alertId: fresh.id, target: { kind: 'customer', customerId, planId }, admin, note: 'new unrelated payment' })
  assert.equal(ok.ok, true)
})

test('crediting held money closes only requests that could be that payment: started before it arrived, any plan of that person', async () => {
  const mine = `VCHS-T-${rid}-13`
  const later = `VCHS-T-${rid}-14`
  const otherPlan = await db.savingsPlan.findFirstOrThrow({ where: { customerId, NOT: { id: planId } } })
  const other = `VCHS-T-${rid}-15`
  const open = { expiresAt: new Date(Date.now() + 20 * 60_000) }
  await newIntent(mine, { amount: 11000.37, createdAt: new Date(Date.now() - 5 * 60_000), ...open })
  await newIntent(later, { amount: 11000.5, createdAt: new Date(Date.now() + 60_000), ...open }) // started after the money arrived
  await newIntent(other, { amount: 11000.6, planId: otherPlan.id, createdAt: new Date(Date.now() - 4 * 60_000), ...open }) // another plan of the same person
  const held = await newAlert('l', 11000.0)
  assert.equal((await creditAlertByHand(db, { alertId: held.id, target: { kind: 'customer', customerId, planId }, admin, note: 'sender is this customer' })).ok, true)
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref: mine } })).status, 'Superseded')
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref: later } })).status, 'Pending')
  // another plan of the same person started before the money arrived: one transfer could have been meant for either
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref: other } })).status, 'Superseded')
})

test('crediting a request by hand closes the person’s other open requests for the same figure', async () => {
  const kept = `VCHS-T-${rid}-16`
  const older = `VCHS-T-${rid}-17`
  await newIntent(older, { amount: 12000.37, expiresAt: new Date(Date.now() + 2 * 60_000) })
  await newIntent(kept, { amount: 12000.62, expiresAt: new Date(Date.now() + 20 * 60_000) })
  assert.equal((await creditRequestByHand(db, { ref: kept, admin, note: 'paid, seen in bank app' })).ok, true)
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref: older } })).status, 'Superseded')
  const again = await creditRequestByHand(db, { ref: older, admin, note: 'same payment?', ackLookalike: true })
  assert.equal(again.ok === false && again.status, 409)
  assert.equal(await db.transaction.count({ where: { ref: older } }), 0)
})

test('crediting a request by hand leaves a NEWER request for the same figure open', async () => {
  const credited = `VCHS-T-${rid}-18`
  const newer = `VCHS-T-${rid}-19`
  await newIntent(credited, { amount: 13000.37, createdAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() + 20 * 60_000) })
  await newIntent(newer, { amount: 13000.62, createdAt: new Date(Date.now() - 1 * 60_000), expiresAt: new Date(Date.now() + 29 * 60_000) })
  assert.equal((await creditRequestByHand(db, { ref: credited, admin, note: 'paid, seen in bank app' })).ok, true)
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { ref: newer } })).status, 'Pending')
})

const dayKey = (daysAgo: number) => watKey(new Date(Date.now() - daysAgo * 86_400_000))

async function onlinePlan(daily = 300) {
  return db.savingsPlan.create({
    data: {
      customerId, dailyAmount: daily, periodDays: 30, cadence: 'daily', source: 'self', goal: `Days ${rid}`,
      startDate: new Date(Date.now() - 5 * 86_400_000), maturityDate: new Date(Date.now() + 25 * 86_400_000),
    },
  })
}

test('held money credited for a chosen missed day counts for that day', async () => {
  const plan = await onlinePlan()
  const alert = await newAlert('d1', 21300.11)
  const key = dayKey(2)
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: plan.id, days: [key] }, admin, note: 'for a missed day', ackLookalike: true })
  assert.equal(r.ok, true)
  const { intentRef } = await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })
  const rows = await db.planDayCoverage.findMany({ where: { savingsPlanId: plan.id } })
  assert.deepEqual(rows.map((c) => [c.coversKey, c.ref]), [[key, intentRef]])
})

test('held money credited with no day chosen covers no day, as before', async () => {
  const plan = await onlinePlan()
  const alert = await newAlert('d2', 22300.11)
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: plan.id }, admin, note: 'no day', ackLookalike: true })
  assert.equal(r.ok, true)
  assert.equal(await db.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('a day already paid is refused and the money stays held, with no stray request', async () => {
  const plan = await onlinePlan()
  const key = dayKey(1)
  await db.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: key, ref: `taken-${rid}` } })
  const alert = await newAlert('d3', 23300.11)
  const count = await db.paymentIntent.count({ where: { planId: plan.id } })
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: plan.id, days: [key] }, admin, note: 'taken day', ackLookalike: true })
  assert.equal(r.ok, false)
  assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
  assert.equal(await db.paymentIntent.count({ where: { planId: plan.id } }), count)
})

test('more days than the payment can pay for are refused', async () => {
  const plan = await onlinePlan(24000)
  const alert = await newAlert('d4', 24000.11)
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: plan.id, days: [dayKey(3), dayKey(2)] }, admin, note: 'too many', ackLookalike: true })
  assert.deepEqual(r, { ok: false, status: 400, error: 'This payment isn’t enough for that many days. Choose fewer.' })
  assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
})

test('a day that is not part of the plan is refused', async () => {
  const plan = await onlinePlan()
  const alert = await newAlert('d5', 25300.11)
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId: plan.id, days: [dayKey(40)] }, admin, note: 'before the plan', ackLookalike: true })
  assert.equal(r.ok, false)
  assert.equal(await db.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('a cash plan can\'t take chosen days', async () => {
  const alert = await newAlert('d6', 26300.11)
  const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId, days: [dayKey(1)] }, admin, note: 'cash plan', ackLookalike: true })
  assert.equal(r.ok, false)
  assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
})
