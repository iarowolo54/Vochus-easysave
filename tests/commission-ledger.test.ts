// Unit test: the ledger writer, the deposit fee, the collection settle-up and the loan helpers, against stub transactions (no database).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma, PrismaClient } from '@prisma/client'
import { collectionFee, completionCredits, depositFeeOps, buildPlanFees, legacyPlatformShare, loanCommissionAmounts, recordCommission, repaymentCommissionAmount } from '../src/lib/commission-ledger'
import { DEFAULT_COMMISSION_RATES } from '../src/lib/commission-rates'

type Row = Record<string, unknown>
type Plan = { cadence: string; dailyAmount: number; source: string; feeCollected: number }
function stubTx(opts: { goLive?: string; rates?: Record<string, number>; existing?: boolean; plan?: Plan; preDeposits?: number } = {}) {
  const calls = { ledger: [] as Row[], agentUpdates: [] as Row[], wallet: [] as Row[], planUpdates: [] as Row[] }
  let collected = opts.plan?.feeCollected ?? 0
  const tx = {
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (where.key === 'commissionGoLive') return opts.goLive ? { value: opts.goLive } : null
        if (where.key === 'commissionRates') return opts.rates ? { value: JSON.stringify(opts.rates) } : null
        return null
      },
    },
    commissionLedger: {
      findUnique: async () => (opts.existing ? { id: 'x' } : null),
      create: async ({ data }: { data: Row }) => { calls.ledger.push(data); return data },
    },
    agent: { update: async (a: Row) => { calls.agentUpdates.push(a); return a } },
    platformWallet: { upsert: async (a: Row) => { calls.wallet.push(a); return a } },
    savingsPlan: {
      findUnique: async () => (opts.plan ? { ...opts.plan, feeCollected: collected } : null),
      updateMany: async (a: { data: { feeCollected: { increment: number } } }) => { collected += a.data.feeCollected.increment; calls.planUpdates.push(a as unknown as Row); return { count: 1 } },
    },
    transaction: { aggregate: async () => ({ _sum: { amount: opts.preDeposits ?? 0 } }) },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, calls, client: tx as unknown as Pick<PrismaClient, 'platformSetting' | 'transaction' | 'ajoPayout'> }
}

const LIVE = '2026-01-01T00:00:00.000Z' // already past, so "now" is after go-live
const NOT_YET = '2099-01-01T00:00:00.000Z'
const DAILY: Plan = { cadence: 'daily', dailyAmount: 500, source: 'agent', feeCollected: 0 }
const dep = (over: Partial<Parameters<typeof depositFeeOps>[1]> = {}) => ({
  planId: 'p1', agentId: 'ag1', customerId: 'c1', amount: 500, ref: 'TXN-1', ...over,
})
const rows = (calls: { ledger: Row[] }) => calls.ledger.map(r => [r.party, r.source, r.amount])

test('the first deposit on a live offline daily plan takes one day as the fee and pays agent and platform', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, plan: DAILY })
  assert.equal(await depositFeeOps(tx, dep()), 500)
  assert.deepEqual(rows(calls), [['agent', 'daily_first', 300], ['platform', 'daily_first', 200]])
  assert.deepEqual(calls.agentUpdates[0].data, { commissionBalance: { increment: 300 } })
  assert.deepEqual((calls.wallet[0] as { update: unknown }).update, { balance: { increment: 200 } })
  assert.equal(calls.planUpdates.length, 1)
})

test('the day is taken once: three deposits of 300 take 300, then 200, then nothing', async () => {
  const { tx } = stubTx({ goLive: LIVE, plan: DAILY })
  const taken = []
  for (let i = 1; i <= 3; i++) taken.push(await depositFeeOps(tx, dep({ amount: 300, ref: `T-${i}` })))
  assert.deepEqual(taken, [300, 200, 0])
})

test('a weekly deposit of 1,000 takes 7.5% split 60/40', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, plan: { ...DAILY, cadence: 'weekly', dailyAmount: 1000 } })
  assert.equal(await depositFeeOps(tx, dep({ amount: 1000 })), 75)
  assert.deepEqual(rows(calls), [['agent', 'periodic_fee', 45], ['platform', 'periodic_fee', 30]])
})

test('uses the saved settings, not fixed ones', async () => {
  const { tx } = stubTx({ goLive: LIVE, rates: { periodicFeePct: 10 }, plan: { ...DAILY, cadence: 'monthly', dailyAmount: 1000 } })
  assert.equal(await depositFeeOps(tx, dep({ amount: 1000 })), 100)
})

test('no fee when go-live is not set or has not arrived yet', async () => {
  assert.equal(await depositFeeOps(stubTx({ plan: DAILY }).tx, dep()), 0)
  assert.equal(await depositFeeOps(stubTx({ goLive: NOT_YET, plan: DAILY }).tx, dep()), 0)
})

test('online self plans take no fee', async () => {
  assert.equal(await depositFeeOps(stubTx({ goLive: LIVE, plan: { ...DAILY, source: 'self' } }).tx, dep()), 0)
})

test('a replayed deposit takes no second fee', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, plan: DAILY, existing: true })
  assert.equal(await depositFeeOps(tx, dep()), 0)
  assert.equal(calls.agentUpdates.length, 0)
})

test('with no agent the whole fee goes to the platform', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, plan: DAILY })
  assert.equal(await depositFeeOps(tx, dep({ agentId: null })), 500)
  assert.deepEqual(rows(calls), [['platform', 'daily_first', 500]])
  assert.equal(calls.agentUpdates.length, 0)
})

test('a deposit smaller than what is owed is all fee', async () => {
  assert.equal(await depositFeeOps(stubTx({ goLive: LIVE, plan: DAILY }).tx, dep({ amount: 100 })), 100)
})

test('recordCommission skips zero amounts and reports whether it wrote', async () => {
  const { tx, calls } = stubTx()
  const e = { party: 'platform' as const, agentId: null, source: 'loan' as const, sourceRef: 'D-1', customerId: null, base: 100, ratePct: 5 }
  assert.equal(await recordCommission(tx, { ...e, amount: 0 }), false)
  assert.equal(await recordCommission(tx, { ...e, amount: 5 }), true)
  assert.equal(calls.ledger.length, 1)
  assert.equal(await recordCommission(stubTx({ existing: true }).tx, { ...e, amount: 5 }), false)
})

test('collectionFee is v1 when not live', async () => {
  assert.deepEqual(await collectionFee(stubTx().client, { id: 'p1', ...DAILY }, 5000, new Date()), { feeRule: 'v1' })
})

test('a live daily plan with nothing collected owes one day, split 60/40', async () => {
  const { client } = stubTx({ goLive: LIVE })
  assert.deepEqual(await collectionFee(client, { id: 'p1', ...DAILY }, 5000, new Date()), { feeRule: 'v2', penalty: 500, feeAgent: 300 })
})

test('a live weekly plan owes the percentage on its older deposits', async () => {
  const { client } = stubTx({ goLive: LIVE, preDeposits: 40000 })
  assert.deepEqual(
    await collectionFee(client, { id: 'p1', cadence: 'weekly', dailyAmount: 1000, source: 'agent', feeCollected: 0 }, 30000, new Date()),
    { feeRule: 'v2', penalty: 2250, feeAgent: 1350 },
  )
})

test('a self plan owes nothing at collection', async () => {
  const { client } = stubTx({ goLive: LIVE })
  assert.deepEqual(await collectionFee(client, { id: 'p1', ...DAILY, source: 'self' }, 5000, new Date()), { feeRule: 'v2', penalty: 0, feeAgent: 0 })
})

const rec = (over: Record<string, unknown> = {}) => ({ ref: 'RED-1', savingsPlanId: 'p1', balance: 3000, penalty: 500, feeAgent: 300, feeRule: 'v2', ...over })

test('a v2 collection credits the stored agent part and the rest to the platform', async () => {
  const { tx, calls } = stubTx()
  assert.deepEqual(await completionCredits(tx, rec(), 'ag1', 'c1'), { agentCredit: 300, platformCredit: 200 })
  assert.deepEqual(rows(calls), [['agent', 'settle_up', 300], ['platform', 'settle_up', 200]])
})

test('a v1 collection keeps the old 3/5 and 2/5 split', async () => {
  const { tx, calls } = stubTx()
  assert.deepEqual(await completionCredits(tx, rec({ feeRule: 'v1', penalty: 1000, feeAgent: 0 }), 'ag1', 'c1'), { agentCredit: 600, platformCredit: 400 })
  assert.deepEqual(rows(calls), [['agent', 'redemption_fee', 600], ['platform', 'redemption_fee', 400]])
})

test('loan commission follows the rates: agent on the principal, platform on the interest', () => {
  assert.deepEqual(loanCommissionAmounts(DEFAULT_COMMISSION_RATES, 50000, 3600), { agent: 500, platform: 180 })
  assert.equal(loanCommissionAmounts({ ...DEFAULT_COMMISSION_RATES, agentLoan: 2 }, 50000, 3600).agent, 1000)
})

test('repayment commission follows the agent repay rate', () => {
  assert.equal(repaymentCommissionAmount(DEFAULT_COMMISSION_RATES, 33600), 168)
  assert.equal(repaymentCommissionAmount({ ...DEFAULT_COMMISSION_RATES, agentRepay: 0 }, 33600), 0)
})

test('buildPlanFees reports whether the model is live and the weekly/monthly percentage', () => {
  assert.deepEqual(buildPlanFees(true, { ...DEFAULT_COMMISSION_RATES, periodicFeePct: 9 }), { live: true, periodicFeePct: 9 })
  assert.deepEqual(buildPlanFees(false, DEFAULT_COMMISSION_RATES), { live: false, periodicFeePct: 7.5 })
})

test('legacyPlatformShare counts the platform part (2/5) of earlier approved fees and skips ones already in the ledger', () => {
  const rows = [{ ref: 'RED-1', penalty: 1000 }, { ref: 'RED-2', penalty: 500 }, { ref: 'RED-3', penalty: 0 }]
  assert.equal(legacyPlatformShare(rows, new Set()), 600)
  assert.equal(legacyPlatformShare(rows, new Set(['RED-1'])), 200)
  assert.equal(legacyPlatformShare([], new Set()), 0)
})

const FLEX = { id: 'p1', cadence: 'flexible', dailyAmount: 0, source: 'agent', feeCollected: 0 }
const END = new Date(2027, 1, 10)

test('a cash flexible plan collected early owes commission and penalty, agent part 60% and 40%', async () => {
  const { client } = stubTx({ goLive: LIVE })
  assert.deepEqual(await collectionFee(client, { ...FLEX, maturityDate: END }, 10000, new Date(2027, 0, 1)), { feeRule: 'v2', penalty: 1000, feeAgent: 500 })
})

test('a cash flexible plan collected on its end date owes the commission only', async () => {
  const { client } = stubTx({ goLive: LIVE })
  assert.deepEqual(await collectionFee(client, { ...FLEX, maturityDate: END }, 10000, new Date(2027, 1, 10, 9)), { feeRule: 'v2', penalty: 500, feeAgent: 300 })
})

test('an online flexible plan owes the penalty when stopped early, nothing at the end', async () => {
  const { client } = stubTx({ goLive: LIVE })
  const online = { ...FLEX, source: 'self', maturityDate: END }
  assert.deepEqual(await collectionFee(client, online, 10000, new Date(2027, 0, 1)), { feeRule: 'v2', penalty: 500, feeAgent: 200 })
  assert.deepEqual(await collectionFee(client, online, 10000, new Date(2027, 1, 11)), { feeRule: 'v2', penalty: 0, feeAgent: 0 })
})

test('flexible charges apply even before the savings go-live date (a new plan type has no old rule)', async () => {
  const { client } = stubTx()
  assert.deepEqual(await collectionFee(client, { ...FLEX, maturityDate: END }, 10000, new Date(2027, 0, 1)), { feeRule: 'v2', penalty: 1000, feeAgent: 500 })
})

test('flexible charges use the saved settings', async () => {
  const { client } = stubTx({ goLive: LIVE })
  const c = client as unknown as { platformSetting: { findUnique: (a: { where: { key: string } }) => Promise<unknown> } }
  const orig = c.platformSetting.findUnique
  c.platformSetting.findUnique = async (a) => a.where.key === 'flexibleSavings'
    ? { value: JSON.stringify({ minTermMonths: 3, minDeposit: 100, cashCommissionPct: 2, cashCommissionAgentPct: 50, penaltyPct: 10, penaltyAgentPct: 0 }) }
    : orig(a)
  assert.deepEqual(await collectionFee(client, { ...FLEX, maturityDate: END }, 10000, new Date(2027, 0, 1)), { feeRule: 'v2', penalty: 1200, feeAgent: 100 })
})

test('a flexible deposit takes no fee', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, plan: { cadence: 'flexible', dailyAmount: 0, source: 'agent', feeCollected: 0 } })
  assert.equal(await depositFeeOps(tx, dep({ amount: 2000 })), 0)
  assert.equal(calls.ledger.length + calls.planUpdates.length + calls.agentUpdates.length, 0)
})
