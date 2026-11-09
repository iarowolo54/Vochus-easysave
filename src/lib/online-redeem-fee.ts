// Online savers' Platform Fee: nothing on deposits; a percentage of the amount saved when they redeem (owner's rule,
// Nov 2026). Super admin sets one rate for redeeming at the end, one for redeeming early, and the agent's share of the
// fee. Applies to every online plan from the moment it's set, flexible plans included (on top of their early-stop
// penalty). Interest is never charged. Ajo pots have their own Platform Fee.
import type { PrismaClient } from '@prisma/client'
import { isEarlyCollection, isFlexible } from '@/lib/flexible-savings'

export const ONLINE_REDEEM_FEE_KEY = 'onlineRedeemFee'
export const ONLINE_REDEEM_FEE_MAX_PCT = 25
export type OnlineRedeemFee = { maturedPct: number; earlyPct: number; agentSharePct: number }
export const ONLINE_REDEEM_FEE_DEFAULT: OnlineRedeemFee = { maturedPct: 0, earlyPct: 0, agentSharePct: 0 }

const cents = (n: number) => Math.round(n * 100) / 100

/** Narrow an untrusted setting; errors are per field. */
export function parseOnlineRedeemFee(raw: unknown): { ok: true; value: OnlineRedeemFee } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v))
  const maturedPct = num(b.maturedPct), earlyPct = num(b.earlyPct), agentSharePct = num(b.agentSharePct)
  const errors: Record<string, string> = {}
  const pctErr = `Enter a percentage from 0 to ${ONLINE_REDEEM_FEE_MAX_PCT}.`
  if (!Number.isFinite(maturedPct) || maturedPct < 0 || maturedPct > ONLINE_REDEEM_FEE_MAX_PCT) errors.maturedPct = pctErr
  if (!Number.isFinite(earlyPct) || earlyPct < 0 || earlyPct > ONLINE_REDEEM_FEE_MAX_PCT) errors.earlyPct = pctErr
  if (!Number.isFinite(agentSharePct) || agentSharePct < 0 || agentSharePct > 100) errors.agentSharePct = 'Enter a percentage from 0 to 100.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { maturedPct: cents(maturedPct), earlyPct: cents(earlyPct), agentSharePct: cents(agentSharePct) } }
}

/** The current setting. Anything unreadable means no fee, so a bad row can never overcharge anyone. */
export async function getOnlineRedeemFee(client: Pick<PrismaClient, 'platformSetting'>): Promise<OnlineRedeemFee> {
  try {
    const s = await client.platformSetting.findUnique({ where: { key: ONLINE_REDEEM_FEE_KEY } })
    if (!s) return { ...ONLINE_REDEEM_FEE_DEFAULT }
    const parsed = parseOnlineRedeemFee(JSON.parse(s.value))
    return parsed.ok ? parsed.value : { ...ONLINE_REDEEM_FEE_DEFAULT }
  } catch {
    return { ...ONLINE_REDEEM_FEE_DEFAULT }
  }
}

/** Early means before the plan's end, by the rule each plan type already uses. */
export function isEarlyRedemption(plan: { cadence: string | null; maturityDate: Date }, at: Date): boolean {
  return isFlexible(plan.cadence) ? isEarlyCollection(plan.maturityDate, at) : at < plan.maturityDate
}

/** The fee on the amount saved, and the agent's part. */
export function onlineFeeOn(saved: number, rate: OnlineRedeemFee, early: boolean): { fee: number; agent: number; pct: number } {
  const pct = early ? rate.earlyPct : rate.maturedPct
  const fee = cents(Math.max(0, saved) * pct / 100)
  return { fee, agent: cents(fee * rate.agentSharePct / 100), pct }
}
