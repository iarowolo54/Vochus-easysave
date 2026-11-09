import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEarlyRedemption, onlineFeeOn, parseOnlineRedeemFee } from '../src/lib/online-redeem-fee'
import { collectionFee } from '../src/lib/commission-ledger'

const now = new Date('2026-11-09T10:00:00Z')
const later = new Date('2027-01-09T10:00:00Z'), before = new Date('2026-10-09T10:00:00Z')
const rate = { maturedPct: 2, earlyPct: 5, agentSharePct: 25 }
const client = (fee: unknown = rate) => ({
  platformSetting: { findUnique: async ({ where: { key } }: { where: { key: string } }) => key === 'onlineRedeemFee' ? { value: JSON.stringify(fee) } : null },
  transaction: { aggregate: async () => ({ _sum: { amount: 0 } }) },
}) as never
const plan = (o: object) => ({ id: 'p', cadence: 'daily', dailyAmount: 500, source: 'self', feeCollected: 0, maturityDate: later, ...o })

test('the rate depends on early or at the end, and the agent share is taken from the fee', () => {
  assert.deepEqual(onlineFeeOn(10000, rate, false), { fee: 200, agent: 50, pct: 2 })
  assert.deepEqual(onlineFeeOn(10000, rate, true), { fee: 500, agent: 125, pct: 5 })
})

test('settings: limits', () => {
  assert.equal(parseOnlineRedeemFee({ maturedPct: '2', earlyPct: '5.5', agentSharePct: '40' }).ok, true)
  for (const bad of [{ maturedPct: '', earlyPct: '1', agentSharePct: '1' }, { maturedPct: '26', earlyPct: '1', agentSharePct: '1' }, { maturedPct: '1', earlyPct: '-1', agentSharePct: '1' }, { maturedPct: '1', earlyPct: '1', agentSharePct: '101' }]) assert.equal(parseOnlineRedeemFee(bad).ok, false, JSON.stringify(bad))
})

test('early means before the end date', () => {
  assert.equal(isEarlyRedemption({ cadence: 'daily', maturityDate: later }, now), true)
  assert.equal(isEarlyRedemption({ cadence: 'weekly', maturityDate: before }, now), false)
})

test('online daily and weekly plans pay it, early and at the end', async () => {
  assert.deepEqual(await collectionFee(client(), plan({}), 10000, now), { feeRule: 'v2', penalty: 500, feeAgent: 125 })
  assert.deepEqual(await collectionFee(client(), plan({ cadence: 'weekly', maturityDate: before }), 10000, now), { feeRule: 'v2', penalty: 200, feeAgent: 50 })
})

test('with no setting, online plans still pay nothing', async () => {
  assert.deepEqual(await collectionFee(client({ maturedPct: 0, earlyPct: 0, agentSharePct: 0 }), plan({}), 10000, now), { feeRule: 'v2', penalty: 0, feeAgent: 0 })
})

test('flexible online plans pay it on top of the early-stop penalty', async () => {
  const flexStop = await collectionFee(client({ maturedPct: 0, earlyPct: 0, agentSharePct: 0 }), plan({ cadence: 'flexible' }), 10000, now) as { penalty: number }
  const both = await collectionFee(client(), plan({ cadence: 'flexible' }), 10000, now) as { penalty: number }
  assert.equal(both.penalty, flexStop.penalty + 500)
})

test('cash plans are not touched', async () => {
  const cash = await collectionFee(client(), plan({ source: 'agent' }), 10000, now)
  assert.notDeepEqual(cash, { feeRule: 'v2', penalty: 500, feeAgent: 125 })
})
