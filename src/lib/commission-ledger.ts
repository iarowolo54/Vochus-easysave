import type { Prisma, PrismaClient } from '@prisma/client'
import { money } from '@/lib/money'
import { getCommissionRates, pct, type CommissionRates } from '@/lib/commission-rates'

export const GO_LIVE_KEY = 'commissionGoLive'

export type LedgerClient = Prisma.TransactionClient
export type LedgerSource = 'savings' | 'savings_catchup' | 'loan' | 'repayment' | 'redemption_fee'

export interface LedgerEntry {
  party: 'agent' | 'platform'
  agentId: string | null
  source: LedgerSource
  sourceRef: string
  customerId: string | null
  base: number
  ratePct: number
  amount: number
}

/** The date the new savings model starts, or null while it is off. Read per request, never cached. */
export async function getGoLive(client: Pick<PrismaClient, 'platformSetting'>): Promise<Date | null> {
  const s = await client.platformSetting.findUnique({ where: { key: GO_LIVE_KEY } })
  if (!s) return null
  const d = new Date(s.value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function isNewModelLive(client: Pick<PrismaClient, 'platformSetting'>, at: Date): Promise<boolean> {
  const live = await getGoLive(client)
  return live !== null && at.getTime() >= live.getTime()
}

/** Writes one ledger row. Returns false (and writes nothing) for a zero amount or a row that already exists. */
export async function recordCommission(tx: LedgerClient, e: LedgerEntry): Promise<boolean> {
  const amount = money(e.amount)
  if (amount <= 0) return false
  const key = { source_sourceRef_party: { source: e.source, sourceRef: e.sourceRef, party: e.party } }
  if (await tx.commissionLedger.findUnique({ where: key })) return false
  await tx.commissionLedger.create({ data: { ...e, amount } })
  return true
}

/**
 * Pays the agent the agent savings rate on one deposit, inside the deposit's own transaction.
 * Returns what was credited. Nothing happens before go-live, on self plans, with no agent, or for a deposit already paid.
 */
export async function savingsCommissionOps(
  tx: LedgerClient,
  i: { agentId: string | null; customerId: string; planSource: string | null; amount: number; ref: string; at: Date },
): Promise<number> {
  if (!i.agentId || i.planSource === 'self') return 0
  if (!(await isNewModelLive(tx, i.at))) return 0
  const rates = await getCommissionRates(tx)
  const amount = pct(i.amount, rates.agentSavings)
  if (amount <= 0) return 0
  const wrote = await recordCommission(tx, {
    party: 'agent', agentId: i.agentId, source: 'savings', sourceRef: i.ref, customerId: i.customerId,
    base: money(i.amount), ratePct: rates.agentSavings, amount,
  })
  if (!wrote) return 0
  await tx.agent.update({ where: { id: i.agentId }, data: { commissionBalance: { increment: amount } } })
  return amount
}

/** The fee a customer pays to redeem: the platform savings rate on the balance. Self plans pay none. */
export function redemptionFee(balance: number, platformSavingsPct: number, planSource: string | null): number {
  return planSource === 'self' ? 0 : pct(balance, platformSavingsPct)
}

/** The part of a balance that was deposited before go-live and so was never paid at deposit time. */
export function catchupBase(preGoLiveDeposits: number, balance: number): number {
  return money(Math.max(0, Math.min(preGoLiveDeposits, balance)))
}

/** What a disbursed loan earns: the agent on the principal, the platform on the interest. */
export function loanCommissionAmounts(rates: CommissionRates, principal: number, interest: number): { agent: number; platform: number } {
  return { agent: pct(principal, rates.agentLoan), platform: pct(interest, rates.platformLoan) }
}

export function repaymentCommissionAmount(rates: CommissionRates, amount: number): number {
  return pct(amount, rates.agentRepay)
}

/**
 * How a redeemed plan's stored fee is credited. A v1 record (requested before go-live) keeps the old 3/5 agent,
 * 2/5 platform split and gets no catch-up; a v2 record's fee is all the platform's and the agent gets the catch-up.
 */
export function completionSplit(rec: { penalty: number; feeRule: string }, catchupAmount: number): { agentCredit: number; platformCredit: number } {
  if (rec.feeRule === 'v2') return { agentCredit: money(catchupAmount), platformCredit: money(rec.penalty) }
  return { agentCredit: money(rec.penalty * (3 / 5)), platformCredit: money(rec.penalty * (2 / 5)) }
}

/** What a new redemption request should use: the new fee rule once live, otherwise today's. */
export async function feeContext(client: Pick<PrismaClient, 'platformSetting'>, at: Date): Promise<{ feeRule: 'v1' } | { feeRule: 'v2'; platformSavingsPct: number }> {
  if (!(await isNewModelLive(client, at))) return { feeRule: 'v1' }
  return { feeRule: 'v2', platformSavingsPct: (await getCommissionRates(client)).platformSavings }
}

/**
 * Works out and records what a completed redemption credits, inside the completion transaction.
 * Returns the agent and platform amounts to credit; the caller applies them to the balances.
 */
export async function completionCredits(
  tx: LedgerClient,
  rec: { ref: string; savingsPlanId: string; balance: number; penalty: number; feeRule: string },
  agentId: string,
  customerId: string | null,
): Promise<{ agentCredit: number; platformCredit: number }> {
  let catchup = 0
  let catchupBasis = 0
  let ratePct = 0
  if (rec.feeRule === 'v2') {
    const goLive = await getGoLive(tx)
    if (goLive) {
      const sum = await tx.transaction.aggregate({
        where: { planId: rec.savingsPlanId, type: 'saving', createdAt: { lt: goLive } },
        _sum: { amount: true },
      })
      catchupBasis = catchupBase(sum._sum.amount ?? 0, rec.balance)
      ratePct = (await getCommissionRates(tx)).agentSavings
      catchup = pct(catchupBasis, ratePct)
    }
  }
  const out = completionSplit(rec, catchup)
  const v2 = rec.feeRule === 'v2'
  await recordCommission(tx, {
    party: 'agent', agentId, source: v2 ? 'savings_catchup' : 'redemption_fee', sourceRef: rec.ref, customerId,
    base: v2 ? catchupBasis : rec.penalty, ratePct: v2 ? ratePct : 60, amount: out.agentCredit,
  })
  await recordCommission(tx, {
    party: 'platform', agentId: null, source: 'redemption_fee', sourceRef: rec.ref, customerId,
    base: rec.balance, ratePct: rec.balance > 0 ? Math.round((rec.penalty / rec.balance) * 10000) / 100 : 0, amount: out.platformCredit,
  })
  return out
}
