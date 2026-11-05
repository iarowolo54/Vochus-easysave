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
    const r = await creditAlertByHand(db, { alertId: alert.id, target: { kind: 'customer', customerId, planId }, admin, note: 'closed plan' })
    assert.equal(r.ok, false)
    assert.equal((await db.bankAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'Unmatched')
    assert.equal(await db.paymentIntent.count({ where: { manualNote: 'closed plan', status: 'Done' } }), 0)
    assert.equal((await db.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance, before)
  } finally {
    await db.savingsPlan.update({ where: { id: planId }, data: { maturityDate: plan.maturityDate } })
  }
})
