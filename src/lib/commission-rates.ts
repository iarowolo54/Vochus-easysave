import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/money'
import type { FeeRules } from '@/lib/savings-fee'

/** Every rate is a percent. */
export interface CommissionRates {
  /** Daily plans: the agent's share of the first day's amount; the rest is the platform's. */
  dailyFirstAgentPct: number
  /** Weekly and monthly plans: the fee taken from each deposit. */
  periodicFeePct: number
  /** Weekly and monthly plans: the agent's share of that fee. */
  periodicAgentPct: number
  agentLoan: number      // of the principal at disbursement
  agentRepay: number     // of each repayment
  platformLoan: number   // of the interest earned
  platformPenalty: number // not applied anywhere yet
}

export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60,
  agentLoan: 1.0, agentRepay: 0.5, platformLoan: 5.0, platformPenalty: 2.0,
}

export const SETTING_KEY = 'commissionRates'
/** Typo guards: no single fee or loan rate may exceed these. */
const MAX_PCT: Partial<Record<keyof CommissionRates, number>> = { periodicFeePct: 25, agentLoan: 10, agentRepay: 10, platformLoan: 50 }

const KEYS = Object.keys(DEFAULT_COMMISSION_RATES) as (keyof CommissionRates)[]
const usable = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100

/** Field by field: a usable number is kept, anything else takes that field's default. */
export function parseCommissionRates(raw: unknown): CommissionRates {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULT_COMMISSION_RATES }
  for (const k of KEYS) if (usable(src[k])) out[k] = src[k]
  return out
}

export async function getCommissionRates(client: Pick<PrismaClient, 'platformSetting'>): Promise<CommissionRates> {
  try {
    const s = await client.platformSetting.findUnique({ where: { key: SETTING_KEY } })
    return parseCommissionRates(s ? JSON.parse(s.value) : null)
  } catch {
    return { ...DEFAULT_COMMISSION_RATES }
  }
}

export function validateRates(rates: unknown): { ok: true; rates: CommissionRates } | { ok: false; error: string } {
  const src = rates && typeof rates === 'object' ? (rates as Record<string, unknown>) : null
  if (!src) return { ok: false, error: 'Invalid payload' }
  for (const k of KEYS) if (!usable(src[k])) return { ok: false, error: `Invalid value for ${k}` }
  const r = src as unknown as CommissionRates
  for (const [k, max] of Object.entries(MAX_PCT)) {
    if (r[k as keyof CommissionRates] > (max as number)) return { ok: false, error: `${k} can't be more than ${max}%` }
  }
  return { ok: true, rates: KEYS.reduce((o, k) => ({ ...o, [k]: r[k] }), {} as CommissionRates) }
}

/** A percent of an amount, rounded to kobo. */
export function pct(amount: number, ratePct: number): number {
  return money((amount * ratePct) / 100)
}

/** The three savings settings, as the fee functions take them. */
export function feeRulesOf(r: CommissionRates): FeeRules {
  return { dailyFirstAgentPct: r.dailyFirstAgentPct, periodicFeePct: r.periodicFeePct, periodicAgentPct: r.periodicAgentPct }
}
