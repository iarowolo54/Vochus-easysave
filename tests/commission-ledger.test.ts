// Unit test: the commission money functions and the ledger writer, against a stub transaction (no database).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { catchupBase, redemptionFee, recordCommission, savingsCommissionOps } from '../src/lib/commission-ledger'

type Row = Record<string, unknown>
function stubTx(opts: { goLive?: string; rates?: Record<string, number>; existing?: boolean } = {}) {
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
