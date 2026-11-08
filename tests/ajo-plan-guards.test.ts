// Tripwire: an Ajo payout plan (SavingsPlan cadence 'ajo') holds a round's pot for its winner to collect. It must never
// be charged, reopened, capped or saved into. If one of these fails, a change has started treating it as a savings plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redemptionDeduction } from '../src/lib/wallet-rates'
import { collectionFee } from '../src/lib/commission-ledger'
import { maxSinglePayment } from '../src/lib/payment-cap'
import { checkReopenable, reopenPlan } from '../src/lib/plan-reopen'
import { planHasEnded } from '../src/lib/plan-credit'
import { notifications as N } from '../src/lib/notifications'
import { hasEnded } from '../src/lib/savings-card'

const now = new Date()
const ajoPlan = { id: 'p1', cadence: 'ajo', dailyAmount: 0, periodDays: 0, source: 'agent', feeCollected: 0, startDate: now, maturityDate: now, status: 'Active', balance: 30000 }
const noDb = new Proxy({}, { get: () => { throw new Error('should not touch the database') } }) as never

test('no deduction when an Ajo pot is collected, cash or online', async () => {
  assert.equal(redemptionDeduction({ balance: 30000, dailyAmount: 0, cadence: 'ajo', hasCashDeposit: true, periodDays: 0, initiator: 'admin', source: 'agent' }).total, 0)
  assert.deepEqual(await collectionFee(noDb, ajoPlan, 30000, now), { feeRule: 'v2', penalty: 0, feeAgent: 0 })
})

test('an Ajo payout plan is ended from the start, so every deposit route refuses it', () => {
  assert.equal(planHasEnded({ maturityDate: now }), true)
})

test('screens treat it as ended on its very first day', () => {
  assert.equal(hasEnded({ ...ajoPlan, maturityDate: now.toISOString() } as never, now), true)
})

test('no payment cap applies (and none is needed)', () => {
  assert.equal(maxSinglePayment(ajoPlan, now), null)
})

test('it can never be reopened or rolled over', async () => {
  const client = { savingsPlan: { findFirst: async () => ajoPlan }, earlyRedemption: noDb } as never
  assert.deepEqual(await reopenPlan(client, { planId: 'p1', customerId: 'c1' }, now), { ok: false, reason: 'not_found' })
  assert.deepEqual(await checkReopenable(client, { planId: 'p1', customerId: 'c1' }, now), { ok: false, reason: 'not_found' })
})

test('its notices say collect, never keep saving', () => {
  assert.doesNotMatch(N.planEnded({ planId: 'p1', customerId: 'c1', goal: 'Ajo · Market, Week 1', ajo: true })[0].body ?? '', /saving/)
  assert.doesNotMatch(N.planUncollected({ planId: 'p1', customerId: 'c1', goal: 'Ajo · Market, Week 1', balance: 1, week: 1, ajo: true })[0].body ?? '', /saving/)
})
