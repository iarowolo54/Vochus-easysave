// Which way money comes IN: agents topping up their wallet, and customers saving online.
//   'transfer' — the company system: bank transfer to Moniepoint, confirmed from the alert email or by staff.
//   'card'     — Paystack (card, transfer or USSD on Paystack's page; auto-debit for customers).
// Set by super admin on Payouts & top-ups. Card is only ever in effect while Paystack is switched on in code
// (src/lib/paystack-off.ts); otherwise everything is bank transfer. Payments already started either way are always
// credited — the switch only decides how NEW payments start.
import type { PrismaClient } from '@prisma/client'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'

export type FundingChannel = 'agent' | 'customer'
export type FundingMethod = 'transfer' | 'card'
export type FundingMode = Record<FundingChannel, FundingMethod>

export const FUNDING_SETTING_KEY = 'fundingMode'
export const DEFAULT_FUNDING_MODE: FundingMode = { agent: 'transfer', customer: 'transfer' }

export const CARD_NOT_IN_USE = 'Card payments aren’t in use right now. Please pay by bank transfer.'
export const TRANSFER_NOT_IN_USE = 'Bank transfer isn’t in use right now. Please pay by card.'

/** Only an explicit "card" flips a channel; anything else (missing, unknown, malformed) is bank transfer. */
export function parseFundingMode(raw: string | null): FundingMode {
  let parsed: unknown
  try { parsed = raw == null ? null : JSON.parse(raw) } catch { return { ...DEFAULT_FUNDING_MODE } }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  return { agent: obj.agent === 'card' ? 'card' : 'transfer', customer: obj.customer === 'card' ? 'card' : 'transfer' }
}

/** What is actually in force: card only while Paystack is on. */
export function effectiveFundingMode(saved: FundingMode, paystackEnabled: boolean): FundingMode {
  return paystackEnabled ? saved : { ...DEFAULT_FUNDING_MODE }
}

export function validateFundingMode(raw: unknown, paystackEnabled: boolean): { ok: true; mode: FundingMode } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const ok = (v: unknown): v is FundingMethod => v === 'transfer' || v === 'card'
  if (!o || !ok(o.agent) || !ok(o.customer)) return { ok: false, error: 'Choose bank transfer or card for both agents and customers.' }
  if (!paystackEnabled && (o.agent === 'card' || o.customer === 'card')) {
    return { ok: false, error: 'Paystack is switched off, so card can’t be chosen yet.' }
  }
  return { ok: true, mode: { agent: o.agent, customer: o.customer } }
}

/** The saved choice (for the settings screen). A read error shows the default rather than breaking the page. */
export async function getSavedFundingMode(client: Pick<PrismaClient, 'platformSetting'>): Promise<FundingMode> {
  try {
    const s = await client.platformSetting.findUnique({ where: { key: FUNDING_SETTING_KEY } })
    return parseFundingMode(s?.value ?? null)
  } catch {
    return { ...DEFAULT_FUNDING_MODE }
  }
}

/** What is in force now. Falls back to bank transfer — the system that works without Paystack. */
export async function getFundingMode(client: Pick<PrismaClient, 'platformSetting'>): Promise<FundingMode> {
  if (!PAYSTACK_ENABLED) return { ...DEFAULT_FUNDING_MODE }
  return effectiveFundingMode(await getSavedFundingMode(client), PAYSTACK_ENABLED)
}
