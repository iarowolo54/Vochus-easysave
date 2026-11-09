// Server-side rules shared by every way of buying specific days on an online plan: the customer's
// Bulk Savings checkout, the agent's Bulk Savings, and the auto-debit cron that has to respect both.
import type { Prisma, PrismaClient, SavingsPlan } from '@prisma/client'
import { BULK_SAVINGS_LABEL, isEligiblePlan, readableKey, validateSelection } from '@/lib/catchup'
import { INTENT_DONE, INTENT_PENDING, parseCoversKeys } from '@/lib/payment-intent'
import { PENDING_HOLD_MS, inFlightKeys, ordinaryDeposits } from '@/lib/pay-ahead'
import { IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import { buildSlotsWat, dayDeposits, periodAlreadySaved, periodWord, watKey } from '@/lib/savings-card'

/**
 * The deposits that were meant to pay for specific days, by plan: those with coverage rows, plus consumed
 * intents that named days. The second covers a payment that ended up buying none, because every day was
 * taken or the amount was wrong. It still doesn't count as "saved today", as nobody paid it for today.
 */
export async function coveringRefsByPlan(client: PrismaClient | Prisma.TransactionClient, planIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>(planIds.map(id => [id, new Set<string>()]))
  if (planIds.length === 0) return new Map()
  const [rows, intents] = await Promise.all([
    client.planDayCoverage.findMany({ where: { savingsPlanId: { in: planIds } }, select: { savingsPlanId: true, ref: true } }),
    client.paymentIntent.findMany({ where: { planId: { in: planIds }, status: INTENT_DONE, coversKeys: { not: null } }, select: { planId: true, ref: true } }),
  ])
  for (const r of rows) out.get(r.savingsPlanId)?.add(r.ref)
  for (const i of intents) if (i.planId) out.get(i.planId)?.add(i.ref)
  return new Map([...out].map(([id, refs]) => [id, [...refs]]))
}

type ReadClient = Pick<PrismaClient, 'autoDebitAttempt'> | Prisma.TransactionClient

/** The slot keys auto-debit is charging on this plan right now. */
export async function chargingKeys(client: ReadClient, plan: Pick<SavingsPlan, 'id' | 'cadence' | 'startDate'>): Promise<Set<string>> {
  const processing = await client.autoDebitAttempt.findMany({ where: { savingsPlanId: plan.id, status: 'processing' }, select: { cycleDate: true } })
  return new Set(inFlightKeys(plan, processing))
}

/**
 * Same rule and signature as hasOpenRedemption on feature/redemption-guard; use that one once it merges. Nothing
 * expires a Pending request, so one whose code ran out unused doesn't count, or it would stop this plan for good.
 */
export async function hasOpenRedemption(client: PrismaClient, planId: string, now = new Date()): Promise<boolean> {
  const open = IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved' && s !== 'Pending')
  const row = await client.earlyRedemption.findFirst({
    where: {
      savingsPlanId: planId,
      OR: [{ status: { in: open } }, { status: 'Pending', tokenExpiry: null }, { status: 'Pending', tokenExpiry: { gte: now } }],
    },
    select: { id: true },
  })
  return row !== null
}

/** Days held by a checkout still open on this plan. A stale one stops holding after PENDING_HOLD_MS. */
export async function heldKeys(client: PrismaClient, planId: string, now: Date, exceptCustomerId?: string): Promise<string[]> {
  const intents = await client.paymentIntent.findMany({
    where: {
      planId,
      status: INTENT_PENDING,
      coversKeys: { not: null },
      createdAt: { gte: new Date(now.getTime() - PENDING_HOLD_MS) },
      ...(exceptCustomerId ? { customerId: { not: exceptCustomerId } } : {}),
    },
    select: { coversKeys: true },
  })
  return intents.flatMap(i => parseCoversKeys(i.coversKeys))
}

/** What auto-debit needs to decide a cycle: the days covered, and the deposits that can fund a slot. */
export async function loadCycleState(client: PrismaClient, planId: string) {
  const [coverage, deposits, refs] = await Promise.all([
    client.planDayCoverage.findMany({ where: { savingsPlanId: planId }, select: { coversKey: true } }),
    client.transaction.findMany({ where: { planId, type: 'saving', status: 'Done' }, select: { ref: true, amount: true, createdAt: true } }),
    coveringRefsByPlan(client, [planId]),
  ])
  return { coveredKeys: coverage.map(c => c.coversKey), plainDeposits: ordinaryDeposits(deposits, refs.get(planId) ?? []) }
}

/** This plan's live slots in WAT: what the customer's calendar shows, as the server sees it. */
export async function liveSlots(client: PrismaClient | Prisma.TransactionClient, plan: Pick<SavingsPlan, 'id' | 'startDate' | 'maturityDate' | 'periodDays' | 'cadence'>, now: Date) {
  const [deposits, coverage, refs] = await Promise.all([
    client.transaction.findMany({ where: { planId: plan.id, type: 'saving', status: 'Done' }, select: { createdAt: true, ref: true } }),
    client.planDayCoverage.findMany({ where: { savingsPlanId: plan.id }, select: { coversKey: true } }),
    coveringRefsByPlan(client, [plan.id]),
  ])
  return buildSlotsWat(
    { startDate: plan.startDate.toISOString(), maturityDate: plan.maturityDate.toISOString(), periodDays: plan.periodDays, cadence: plan.cadence },
    dayDeposits(deposits, refs.get(plan.id)).map(d => d.createdAt.toISOString()),
    coverage.map(c => c.coversKey),
    now,
  )
}

/** Has the day, week or month holding `at` already been saved on this plan? Works inside a write. */
export async function periodSavedOn(
  client: PrismaClient | Prisma.TransactionClient,
  plan: Pick<SavingsPlan, 'id' | 'startDate' | 'maturityDate' | 'periodDays' | 'cadence'>,
  at: Date,
): Promise<boolean> {
  return periodAlreadySaved(await liveSlots(client, plan, at), watKey(at), plan.cadence)
}

/** Why an ordinary online payment is refused, or null when it may go ahead. Bulk Savings doesn't come through here. */
export async function periodPaidError(client: PrismaClient, plan: SavingsPlan, now: Date): Promise<string | null> {
  if (!(await periodSavedOn(client, plan, now))) return null
  const ahead = isEligiblePlan(plan) ? ` To save ahead, use ${BULK_SAVINGS_LABEL}.` : ''
  return `You’ve already saved for ${periodWord(plan.cadence)}.${ahead}`
}

/** Who is buying: the customer themselves, or their agent recording it for them. */
export type BulkBuyer = { kind: 'customer'; customerId: string } | { kind: 'agent' }

export type BulkCheck = { ok: true; total: number } | { ok: false; status: 400 | 409; error: string }

/** Can these days be bought on this plan right now? The total is computed here, never taken from the client. */
export async function checkBulkSelection(client: PrismaClient, plan: SavingsPlan, keys: string[], now: Date, buyer: BulkBuyer): Promise<BulkCheck> {
  if (!isEligiblePlan(plan)) return { ok: false, status: 400, error: 'Bulk Savings isn’t available for this plan' }
  if (plan.maturityDate.getTime() <= now.getTime()) return { ok: false, status: 400, error: 'This plan has ended' }
  if (await hasOpenRedemption(client, plan.id, now)) {
    return { ok: false, status: 409, error: 'This plan has a redemption in progress, so no more can be added to it right now' }
  }

  const result = validateSelection(plan, await liveSlots(client, plan, now), keys)
  if (!result.ok) return { ok: false, status: 400, error: result.error }

  // A day auto-debit is charging right now would otherwise be paid for twice.
  const charging = await chargingKeys(client, plan)
  const beingCharged = keys.find(k => charging.has(k))
  if (beingCharged) return { ok: false, status: 409, error: `The card on this plan is being charged for ${readableKey(beingCharged)}. Remove it, or try again shortly` }

  // A customer who backed out of checkout can start again straight away. Their older intent is deliberately left
  // Pending, not cancelled: if that checkout still gets paid it must be credited, and settlement then writes only the
  // days still free. So paying twice loses nothing; the extra money stays in their savings.
  const held = new Set(await heldKeys(client, plan.id, now, buyer.kind === 'customer' ? buyer.customerId : undefined))
  const open = keys.find(k => held.has(k))
  if (open) {
    return {
      ok: false,
      status: 409,
      error: buyer.kind === 'agent'
        ? `The customer has a card payment open for ${readableKey(open)}. Pick another day, or try again in about an hour`
        : `A payment for ${readableKey(open)} is still open. Finish it, or try again in about an hour`,
    }
  }

  return { ok: true, total: result.total }
}
