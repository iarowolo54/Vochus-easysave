import type { Prisma, PrismaClient } from '@prisma/client'
import { money } from '@/lib/money'
import { feeRulesOf, getCommissionRates, pct, type CommissionRates } from '@/lib/commission-rates'
import { depositFee, settleUpFee } from '@/lib/savings-fee'

export const GO_LIVE_KEY = 'commissionGoLive'

export type LedgerClient = Prisma.TransactionClient
export type LedgerSource = 'daily_first' | 'periodic_fee' | 'settle_up' | 'loan' | 'repayment' | 'redemption_fee'

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

/** Adds to the platform's Revenue wallet. */
async function creditRevenue(tx: LedgerClient, amount: number): Promise<void> {
  await tx.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: amount } }, create: { type: 'Revenue', balance: amount } })
}

/**
 * Takes the platform fee out of one deposit to an offline plan, inside the deposit's own transaction, and pays the agent
 * their share at once. Returns the fee taken; the caller credits the plan balance with the deposit minus that fee.
 * Nothing happens before go-live, for a deposit dated before it, on online (self) plans, or for a deposit already processed.
 */
export async function depositFeeOps(
  tx: LedgerClient,
  i: { planId: string; agentId: string | null; customerId: string; amount: number; ref: string; at: Date },
): Promise<number> {
  if (!(await isNewModelLive(tx, i.at))) return 0
  const plan = await tx.savingsPlan.findUnique({ where: { id: i.planId }, select: { cadence: true, dailyAmount: true, source: true, feeCollected: true } })
  if (!plan || plan.source === 'self') return 0
  const rates = await getCommissionRates(tx)
  const split = depositFee({ cadence: plan.cadence, dailyAmount: plan.dailyAmount, feeCollected: plan.feeCollected, deposit: i.amount }, feeRulesOf(rates))
  if (split.fee <= 0) return 0
  const daily = !plan.cadence || plan.cadence === 'daily'
  const source: LedgerSource = daily ? 'daily_first' : 'periodic_fee'
  const agentPct = daily ? rates.dailyFirstAgentPct : rates.periodicAgentPct
  const agentShare = i.agentId ? split.agent : 0
  const platformShare = money(split.fee - agentShare)
  const done = await tx.commissionLedger.findUnique({ where: { source_sourceRef_party: { source, sourceRef: i.ref, party: 'platform' } } })
    ?? (i.agentId ? await tx.commissionLedger.findUnique({ where: { source_sourceRef_party: { source, sourceRef: i.ref, party: 'agent' } } }) : null)
  if (done) return 0
  // Only one writer may move feeCollected from the value this fee was worked out against.
  const moved = await tx.savingsPlan.updateMany({ where: { id: i.planId, feeCollected: plan.feeCollected }, data: { feeCollected: { increment: split.fee } } })
  if (moved.count !== 1) throw new Error('FEE_STATE_CHANGED')
  if (agentShare > 0 && i.agentId) {
    await tx.agent.update({ where: { id: i.agentId }, data: { commissionBalance: { increment: agentShare } } })
    await recordCommission(tx, { party: 'agent', agentId: i.agentId, source, sourceRef: i.ref, customerId: i.customerId, base: money(i.amount), ratePct: agentPct, amount: agentShare })
  }
  if (platformShare > 0) {
    await creditRevenue(tx, platformShare)
    await recordCommission(tx, { party: 'platform', agentId: null, source, sourceRef: i.ref, customerId: i.customerId, base: money(i.amount), ratePct: money(100 - (i.agentId ? agentPct : 0)), amount: platformShare })
  }
  return split.fee
}

/**
 * What a collection request owes in fee, worked out at request time and stored on it. Before go-live: the old rule (v1).
 * After: only what the deposits did not already pay (v2), split with the agent's part stored so a later rate edit cannot change it.
 */
export async function collectionFee(
  client: Pick<PrismaClient, 'platformSetting' | 'transaction'>,
  plan: { id: string; cadence: string | null; dailyAmount: number; source: string | null; feeCollected: number },
  balance: number,
  at: Date,
): Promise<{ feeRule: 'v1' } | { feeRule: 'v2'; penalty: number; feeAgent: number }> {
  const goLive = await getGoLive(client)
  if (!goLive || at.getTime() < goLive.getTime()) return { feeRule: 'v1' }
  if (plan.source === 'self') return { feeRule: 'v2', penalty: 0, feeAgent: 0 }
  const sum = await client.transaction.aggregate({ where: { planId: plan.id, type: 'saving', createdAt: { lt: goLive } }, _sum: { amount: true } })
  const rates = await getCommissionRates(client)
  const out = settleUpFee({ cadence: plan.cadence, dailyAmount: plan.dailyAmount, feeCollected: plan.feeCollected, balance, preGoLiveDeposits: sum._sum.amount ?? 0 }, feeRulesOf(rates))
  return { feeRule: 'v2', penalty: out.fee, feeAgent: out.agent }
}

/**
 * Records and returns what a completed collection credits, inside the completion transaction. The caller applies the amounts
 * to the agent's commission balance and the Revenue wallet. A v1 record (requested before go-live) keeps the old 3/5, 2/5 split.
 */
export async function completionCredits(
  tx: LedgerClient,
  rec: { ref: string; savingsPlanId: string; balance: number; penalty: number; feeRule: string; feeAgent: number },
  agentId: string,
  customerId: string | null,
): Promise<{ agentCredit: number; platformCredit: number }> {
  const v2 = rec.feeRule === 'v2'
  const agentCredit = v2 ? money(rec.feeAgent) : money(rec.penalty * (3 / 5))
  const platformCredit = money(rec.penalty - agentCredit)
  const source: LedgerSource = v2 ? 'settle_up' : 'redemption_fee'
  await recordCommission(tx, { party: 'agent', agentId, source, sourceRef: rec.ref, customerId, base: money(rec.penalty), ratePct: rec.penalty > 0 ? money((agentCredit / rec.penalty) * 100) : 0, amount: agentCredit })
  await recordCommission(tx, { party: 'platform', agentId: null, source, sourceRef: rec.ref, customerId, base: money(rec.balance), ratePct: rec.balance > 0 ? Math.round((rec.penalty / rec.balance) * 10000) / 100 : 0, amount: platformCredit })
  return { agentCredit, platformCredit }
}

/** What a disbursed loan earns: the agent on the principal, the platform on the interest. */
export function loanCommissionAmounts(rates: CommissionRates, principal: number, interest: number): { agent: number; platform: number } {
  return { agent: pct(principal, rates.agentLoan), platform: pct(interest, rates.platformLoan) }
}

export function repaymentCommissionAmount(rates: CommissionRates, amount: number): number {
  return pct(amount, rates.agentRepay)
}

/** What the plan screens need to describe the fee: whether the new model is on, and the weekly/monthly percentage. */
export function buildPlanFees(live: boolean, rates: CommissionRates): { live: boolean; periodicFeePct: number } {
  return { live, periodicFeePct: rates.periodicFeePct }
}
