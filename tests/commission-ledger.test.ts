// Unit test: the commission money functions and the ledger writer, against a stub transaction (no database).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { catchupBase, completionCredits, completionSplit, feeContext, loanCommissionAmounts, redemptionFee, recordCommission, repaymentCommissionAmount, savingsCommissionOps } from '../src/lib/commission-ledger'
import { DEFAULT_COMMISSION_RATES } from '../src/lib/commission-rates'
import { redemptionDeduction } from '../src/lib/wallet-rates'

type Row = Record<string, unknown>
function stubTx(opts: { goLive?: string; rates?: Record<string, number>; existing?: boolean; preDeposits?: number } = {}) {
  const calls = { ledger: [] as Row[], agentUpdates: [] as Row[] }
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
    transaction: { aggregate: async () => ({ _sum: { amount: opts.preDeposits ?? 0 } }) },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, calls }
}

const LIVE = '2026-11-10T00:00:00.000Z'
const dep = (over: Partial<Parameters<typeof savingsCommissionOps>[1]> = {}) => ({
  agentId: 'ag1', customerId: 'c1', planSource: null, amount: 1000, ref: 'TXN-1', at: new Date('2026-11-12T10:00:00Z'), ...over,
})

test('a live deposit credits the agent savings rate and writes one agent row', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE })
  assert.equal(await savingsCommissionOps(tx, dep()), 4)
  assert.equal(calls.ledger.length, 1)
  assert.deepEqual({ party: calls.ledger[0].party, source: calls.ledger[0].source, sourceRef: calls.ledger[0].sourceRef, amount: calls.ledger[0].amount }, { party: 'agent', source: 'savings', sourceRef: 'TXN-1', amount: 4 })
  assert.deepEqual((calls.agentUpdates[0].data as Row), { commissionBalance: { increment: 4 } })
})

test('uses the rate from the settings, not a fixed one', async () => {
  const { tx } = stubTx({ goLive: LIVE, rates: { agentSavings: 1 } })
  assert.equal(await savingsCommissionOps(tx, dep()), 10)
})

test('nothing is credited before go-live or when go-live is not set', async () => {
  assert.equal(await savingsCommissionOps(stubTx().tx, dep()), 0)
  assert.equal(await savingsCommissionOps(stubTx({ goLive: LIVE }).tx, dep({ at: new Date('2026-11-09T23:59:00Z') })), 0)
})

test('self plans and deposits with no agent earn nothing', async () => {
  assert.equal(await savingsCommissionOps(stubTx({ goLive: LIVE }).tx, dep({ planSource: 'self' })), 0)
  assert.equal(await savingsCommissionOps(stubTx({ goLive: LIVE }).tx, dep({ agentId: null })), 0)
})

test('a replayed deposit does not pay twice', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, existing: true })
  assert.equal(await savingsCommissionOps(tx, dep()), 0)
  assert.equal(calls.agentUpdates.length, 0)
})

test('a deposit that rounds to no commission writes no row', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE })
  assert.equal(await savingsCommissionOps(tx, dep({ amount: 1 })), 0)
  assert.equal(calls.ledger.length, 0)
})

test('a rate of 0 means no credit', async () => {
  assert.equal(await savingsCommissionOps(stubTx({ goLive: LIVE, rates: { agentSavings: 0 } }).tx, dep()), 0)
})

test('recordCommission skips zero amounts and reports whether it wrote', async () => {
  const { tx, calls } = stubTx()
  const e = { party: 'platform' as const, agentId: null, source: 'loan' as const, sourceRef: 'D-1', customerId: null, base: 100, ratePct: 5 }
  assert.equal(await recordCommission(tx, { ...e, amount: 0 }), false)
  assert.equal(await recordCommission(tx, { ...e, amount: 5 }), true)
  assert.equal(calls.ledger.length, 1)
  assert.equal(await recordCommission(stubTx({ existing: true }).tx, { ...e, amount: 5 }), false)
})

test('the redemption fee is the platform savings rate on the balance', () => {
  assert.equal(redemptionFee(62000, 1.6, null), 992)
  assert.equal(redemptionFee(62000, 1.6, 'self'), 0)
  assert.equal(redemptionFee(100, 0, null), 0)
})

test('the catch-up base is the pre-go-live deposits, capped at the balance and never negative', () => {
  assert.equal(catchupBase(5000, 3000), 3000)
  assert.equal(catchupBase(2000, 3000), 2000)
  assert.equal(catchupBase(-1, 3000), 0)
})

test('loan commission follows the rates: agent on the principal, platform on the interest', () => {
  assert.deepEqual(loanCommissionAmounts(DEFAULT_COMMISSION_RATES, 50000, 3600), { agent: 500, platform: 180 })
  assert.equal(loanCommissionAmounts({ ...DEFAULT_COMMISSION_RATES, agentLoan: 2 }, 50000, 3600).agent, 1000)
})

test('repayment commission follows the agent repay rate', () => {
  assert.equal(repaymentCommissionAmount(DEFAULT_COMMISSION_RATES, 33600), 168)
  assert.equal(repaymentCommissionAmount({ ...DEFAULT_COMMISSION_RATES, agentRepay: 0 }, 33600), 0)
})

const plan = { dailyAmount: 1000, cadence: 'daily', hasCashDeposit: true }

test('with a platform savings rate the whole fee is the platform\'s and the agent gets none of it', () => {
  assert.deepEqual(redemptionDeduction({ balance: 62000, ...plan, platformSavingsPct: 1.6 }), { total: 992, platform: 992, agent: 0 })
})

test('self plans pay no fee under the new rule either', () => {
  assert.deepEqual(redemptionDeduction({ balance: 62000, ...plan, source: 'self', platformSavingsPct: 1.6 }), { total: 0, platform: 0, agent: 0 })
})

test('without a platform savings rate the old fee is unchanged', () => {
  assert.equal(redemptionDeduction({ balance: 31000, ...plan }).total, 1000)
})

test('a v1 redemption still splits its stored fee 3/5 agent and 2/5 platform and ignores any catch-up', () => {
  assert.deepEqual(completionSplit({ penalty: 1000, feeRule: 'v1' }, 40), { agentCredit: 600, platformCredit: 400 })
})

test('a v2 redemption gives the platform the whole fee and the agent only the catch-up', () => {
  assert.deepEqual(completionSplit({ penalty: 992, feeRule: 'v2' }, 40), { agentCredit: 40, platformCredit: 992 })
})

test('feeContext is v2 with the platform rate once live, and v1 with nothing before', async () => {
  const live = stubTx({ goLive: LIVE, rates: { platformSavings: 2 } }).tx
  assert.deepEqual(await feeContext(live, new Date('2026-11-12T00:00:00Z')), { feeRule: 'v2', platformSavingsPct: 2 })
  assert.deepEqual(await feeContext(live, new Date('2026-11-01T00:00:00Z')), { feeRule: 'v1' })
  assert.deepEqual(await feeContext(stubTx().tx, new Date()), { feeRule: 'v1' })
})

const rec = (over: Partial<Parameters<typeof completionCredits>[1]> = {}) => ({ ref: 'RED-1', savingsPlanId: 'p1', balance: 3000, penalty: 48, feeRule: 'v2', ...over })

test('a v2 redemption credits the catch-up on pre-go-live deposits and books the whole fee to the platform', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, preDeposits: 2000 })
  const out = await completionCredits(tx, rec(), 'ag1', 'c1')
  assert.deepEqual(out, { agentCredit: 8, platformCredit: 48 })
  assert.deepEqual(calls.ledger.map(r => [r.party, r.source, r.amount]), [['agent', 'savings_catchup', 8], ['platform', 'redemption_fee', 48]])
})

test('the catch-up never exceeds the balance', async () => {
  const { tx } = stubTx({ goLive: LIVE, preDeposits: 99999 })
  assert.equal((await completionCredits(tx, rec({ balance: 1000, penalty: 16 }), 'ag1', 'c1')).agentCredit, 4)
})

test('a v1 redemption keeps the old split and writes both ledger rows, with no catch-up', async () => {
  const { tx, calls } = stubTx({ goLive: LIVE, preDeposits: 2000 })
  const out = await completionCredits(tx, rec({ feeRule: 'v1', penalty: 1000 }), 'ag1', 'c1')
  assert.deepEqual(out, { agentCredit: 600, platformCredit: 400 })
  assert.deepEqual(calls.ledger.map(r => [r.party, r.source, r.amount]), [['agent', 'redemption_fee', 600], ['platform', 'redemption_fee', 400]])
})

test('a v2 redemption with no go-live date set (should not happen) pays no catch-up', async () => {
  const { tx } = stubTx({ preDeposits: 2000 })
  assert.equal((await completionCredits(tx, rec(), 'ag1', 'c1')).agentCredit, 0)
})
