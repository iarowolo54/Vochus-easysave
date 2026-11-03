// Server-side rules shared by every way of buying specific days on an online plan: the customer's
// Bulk Savings checkout, the agent's Bulk Savings, and the auto-debit cron that has to respect both.
import type { Prisma, PrismaClient, SavingsPlan } from '@prisma/client'
import { isEligiblePlan, readableKey, validateSelection } from '@/lib/catchup'
import { INTENT_DONE, INTENT_PENDING, INTENT_REVIEW, parseCoversKeys } from '@/lib/payment-intent'
import { money } from '@/lib/wallet-guard'
import { PENDING_HOLD_MS, inFlightKeys, ordinaryDeposits } from '@/lib/pay-ahead'
import { IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import { buildSlotsWat, dayDeposits } from '@/lib/savings-card'

type ReadClient = Pick<PrismaClient, 'autoDebitAttempt'> | Prisma.TransactionClient

/**
 * Days covered on each plan, and the deposits that were meant to pay for specific days: those with coverage rows, plus
 * consumed intents that named days. The second covers a payment that ended up buying none, because every day was taken
 * or the amount was wrong. It still doesn't count as "saved today", as nobody paid it for today.
 */
export async function coverageByPlan(client: PrismaClient, planIds: string[]): Promise<Map<string, { keys: string[]; refs: string[] }>> {
  const out = new Map<string, { keys: string[]; refs: Set<string> }>(planIds.map(id => [id, { keys: [], refs: new Set<string>() }]))
  if (planIds.length === 0) return new Map()
  const [rows, intents] = await Promise.all([
    client.planDayCoverage.findMany({ where: { savingsPlanId: { in: planIds } }, select: { savingsPlanId: true, coversKey: true, ref: true }, orderBy: { coversKey: 'asc' } }),
    client.paymentIntent.findMany({ where: { planId: { in: planIds }, status: INTENT_DONE, coversKeys: { not: null } }, select: { planId: true, ref: true } }),
  ])
  for (const r of rows) {
    const plan = out.get(r.savingsPlanId)
    plan?.keys.push(r.coversKey)
    plan?.refs.add(r.ref)
  }
  for (const i of intents) if (i.planId) out.get(i.planId)?.refs.add(i.ref)
  return new Map([...out].map(([id, c]) => [id, { keys: c.keys, refs: [...c.refs] }]))
}

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
  const [coverage, deposits] = await Promise.all([
    coverageByPlan(client, [planId]),
    client.transaction.findMany({ where: { planId, type: 'saving', status: 'Done' }, select: { ref: true, amount: true, createdAt: true } }),
  ])
  const plan = coverage.get(planId)
  return { coveredKeys: plan?.keys ?? [], plainDeposits: ordinaryDeposits(deposits, plan?.refs ?? []) }
}

/** This plan's live slots in WAT: what the customer's calendar shows, as the server sees it. */
export async function liveSlots(client: PrismaClient, plan: SavingsPlan, now: Date) {
  const [deposits, coverage] = await Promise.all([
    client.transaction.findMany({ where: { planId: plan.id, type: 'saving', status: 'Done' }, select: { createdAt: true, ref: true, amount: true } }),
    coverageByPlan(client, [plan.id]),
  ])
  const covered = coverage.get(plan.id)
  return buildSlotsWat(
    { startDate: plan.startDate.toISOString(), maturityDate: plan.maturityDate.toISOString(), periodDays: plan.periodDays, cadence: plan.cadence, source: plan.source, dailyAmount: plan.dailyAmount },
    dayDeposits(deposits, covered?.refs).map(d => ({ createdAt: d.createdAt.toISOString(), amount: d.amount })),
    covered?.keys ?? [],
    now,
  )
}

/** Who is buying: the customer themselves, or their agent recording it for them. */
export type BulkBuyer = { kind: 'customer'; customerId: string } | { kind: 'agent' }

export type BulkCheck = { ok: true; total: number } | { ok: false; status: 400 | 409; error: string }

/** Can these days be bought on this plan right now? The total is computed here, never taken from the client. */
export async function checkBulkSelection(client: PrismaClient, plan: SavingsPlan, keys: string[], now: Date, buyer: BulkBuyer): Promise<BulkCheck> {
  if (!isEligiblePlan(plan)) return { ok: false, status: 400, error: 'Bulk Savings isn’t available for this plan' }
  if (plan.maturityDate.getTime() <= now.getTime()) return { ok: false, status: 400, error: 'This plan has ended' }
  if (await hasOpenRedemption(client, plan.id, now)) {
    return { ok: false, status: 409, error: 'This plan has a collection in progress, so no more can be added to it right now' }
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

export type PaymentNotice = { ref: string; planId: string; count: number; weekly: boolean; reason: 'amount' | 'overlap'; amount: number; at: Date | null }

const NOTICE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/**
 * What a customer should keep being told about their payments: days they paid for that the payment didn't buy, and money
 * held for review. Worked out from stored rows on each load, so the notice lasts past the callback screen.
 */
export async function paymentNotices(client: PrismaClient, customerId: string, planIds: string[], now: Date = new Date()) {
  const since = new Date(now.getTime() - NOTICE_WINDOW_MS)
  const [intents, heldIntents, heldAttempts] = await Promise.all([
    client.paymentIntent.findMany({ where: { customerId, status: INTENT_DONE, coversKeys: { not: null }, consumedAt: { gte: since } }, orderBy: { consumedAt: 'desc' }, take: 50 }),
    client.paymentIntent.findMany({ where: { customerId, status: INTENT_REVIEW }, select: { ref: true, amount: true, createdAt: true } }),
    planIds.length ? client.autoDebitAttempt.findMany({ where: { savingsPlanId: { in: planIds }, status: 'review' }, select: { reference: true, creditAmount: true, createdAt: true } }) : Promise.resolve([]),
  ])
  const refs = intents.map(i => i.ref)
  const [bought, credits, plans] = await Promise.all([
    client.planDayCoverage.findMany({ where: { ref: { in: refs } }, select: { ref: true, coversKey: true } }),
    client.transaction.findMany({ where: { ref: { in: refs } }, select: { ref: true, amount: true } }),
    client.savingsPlan.findMany({ where: { customerId }, select: { id: true, cadence: true } }),
  ])
  const notices: PaymentNotice[] = []
  for (const intent of intents) {
    const wanted = parseCoversKeys(intent.coversKeys)
    const got = bought.filter(b => b.ref === intent.ref && wanted.includes(b.coversKey)).length
    const credit = credits.find(c => c.ref === intent.ref)
    if (got >= wanted.length || !credit || !intent.planId) continue
    notices.push({
      ref: intent.ref,
      planId: intent.planId,
      count: wanted.length - got,
      weekly: plans.find(p => p.id === intent.planId)?.cadence === 'weekly',
      reason: money(credit.amount) === money(intent.amount) ? 'overlap' : 'amount',
      amount: credit.amount,
      at: intent.consumedAt,
    })
  }
  const held = [
    ...heldIntents.map(i => ({ ref: i.ref, amount: i.amount, at: i.createdAt })),
    ...heldAttempts.map(a => ({ ref: a.reference, amount: a.creditAmount, at: a.createdAt })),
  ]
  return { paymentNotices: notices, heldPayments: held }
}
