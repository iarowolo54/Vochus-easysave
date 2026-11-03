import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/money'

/** Every rate is a percent. Savings rates apply to each deposit (and to the balance at redemption). */
export interface CommissionRates {
  agentSavings: number
  agentLoan: number      // of the principal at disbursement
  agentRepay: number     // of each repayment
  platformSavings: number
  platformLoan: number   // of the interest earned
  platformPenalty: number // not applied anywhere yet
}

export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  agentSavings: 0.4, agentLoan: 1.0, agentRepay: 0.5,
  platformSavings: 1.6, platformLoan: 5.0, platformPenalty: 2.0,
}

export const SETTING_KEY = 'commissionRates'
export const MAX_COMBINED_SAVINGS_PCT = 10
/** Typo guards: no single loan or repayment rate may exceed these. */
const MAX_PCT: Partial<Record<keyof CommissionRates, number>> = { agentLoan: 10, agentRepay: 10, platformLoan: 50 }

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
  if (r.agentSavings + r.platformSavings > MAX_COMBINED_SAVINGS_PCT) {
    return { ok: false, error: `Agent and platform savings rates can't add up to more than ${MAX_COMBINED_SAVINGS_PCT}%` }
  }
  return { ok: true, rates: KEYS.reduce((o, k) => ({ ...o, [k]: r[k] }), {} as CommissionRates) }
}

/** A percent of an amount, rounded to kobo. */
export function pct(amount: number, ratePct: number): number {
  return money((amount * ratePct) / 100)
}
