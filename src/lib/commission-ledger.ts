import type { Prisma, PrismaClient } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
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
