// Ajo Platform Fee: the super admin's setting, and what a pot's collection actually costs.
import type { PrismaClient } from '@prisma/client'
import { AJO_FEE_DEFAULT, ajoFeeOn, parseAjoFee, type AjoFee } from '@/lib/ajo'

export const AJO_FEE_SETTING_KEY = 'ajoPlatformFee'

/** The current setting. Anything unreadable means no fee, so a bad row can never overcharge anyone. */
export async function getAjoFee(client: Pick<PrismaClient, 'platformSetting'>): Promise<AjoFee> {
  try {
    const s = await client.platformSetting.findUnique({ where: { key: AJO_FEE_SETTING_KEY } })
    if (!s) return { ...AJO_FEE_DEFAULT }
    const parsed = parseAjoFee(JSON.parse(s.value))
    return parsed.ok ? parsed.value : { ...AJO_FEE_DEFAULT }
  } catch {
    return { ...AJO_FEE_DEFAULT }
  }
}

/**
 * The fee on one Ajo plan, at its group's locked rate. Only a member's turn is charged: a refund plan has no payout
 * row, so it comes back as no fee. The base is what this person is collecting.
 */
export async function ajoPlanFee(client: Pick<PrismaClient, 'ajoPayout'>, planId: string, balance: number) {
  const row = await client.ajoPayout.findUnique({ where: { savingsPlanId: planId }, select: { group: { select: { feePct: true, feeAgentSharePct: true } } } })
  if (!row) return { fee: 0, agent: 0, platform: 0, feePct: 0 }
  return { ...ajoFeeOn(balance, { feePct: row.group.feePct, agentSharePct: row.group.feeAgentSharePct }), feePct: row.group.feePct }
}

/** Fee amounts for several Ajo plans at once, for the screens that preview a collection. Keyed by plan id. */
export async function ajoPlanFees(client: Pick<PrismaClient, 'ajoPayout'>, plans: { id: string; balance: number }[]) {
  const out = new Map<string, { fee: number; feePct: number }>()
  if (plans.length === 0) return out
  const rows = await client.ajoPayout.findMany({ where: { savingsPlanId: { in: plans.map(p => p.id) } }, select: { savingsPlanId: true, group: { select: { feePct: true, feeAgentSharePct: true } } } })
  const byPlan = new Map(rows.map(r => [r.savingsPlanId, r.group]))
  for (const p of plans) {
    const g = byPlan.get(p.id)
    out.set(p.id, g ? { fee: ajoFeeOn(p.balance, { feePct: g.feePct, agentSharePct: g.feeAgentSharePct }).fee, feePct: g.feePct } : { fee: 0, feePct: 0 })
  }
  return out
}
