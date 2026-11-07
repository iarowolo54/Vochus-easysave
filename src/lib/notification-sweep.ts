// Safeguard 4 of in-app notifications: the nightly safety net (run from /api/cron/daily).
//  1. Backfill: rebuilds, from the records, every notification the live paths should have written in the last 48 hours,
//     with the SAME catalogue calls and dedupe keys, and writes only the ones that are missing. It counts and logs
//     them, so a missed live path shows up instead of hiding.
//  2. Scheduled: the date-based notices (plan ending in 7 days, plan ended, the agent's "plans end this week").
// It never duplicates: every write is an upsert on dedupeKey that doesn't overwrite.
import type { PrismaClient } from '@prisma/client'
import { notifications as N, notify, type NotificationEvent } from '@/lib/notifications'
import { logAudit } from '@/lib/audit'

/** Bulk Savings stamps each day's transaction with this + the batch's first ref, so the batch is one notification. */
export const BULK_NOTE_PREFIX = 'Bulk Savings batch '
export const BACKFILL_HOURS = 48
const DAY = 86_400_000

type Cust = { id: string; agentId: string; firstName: string; lastName: string }
export interface SweepRows {
  savings: { ref: string; amount: number; feeTaken: number; method: string | null; note: string | null; createdAt: Date; plan: { goal: string; source: string; customer: Cust } }[]
  collections: { id: string; ref: string; status: string; netPayout: number; requestedAt: Date; agentApprovedAt: Date | null; decidedAt: Date | null; decidedBy: string | null; savingsPlan: { customer: Cust } }[]
  withdrawals: { id: string; agentId: string; amount: number; status: string; adminNote: string | null; decidedAt: Date | null }[]
  topUps: { ref: string; agentId: string; amount: number; createdAt: Date }[]
}

const nameOf = (c: Cust) => `${c.firstName} ${c.lastName}`
const at = (events: NotificationEvent[], when: Date) => events.map(e => ({ ...e, at: when }))

/** The notifications the live paths write for these records. Each event only if it happened since `since`. */
export function backfillEvents(rows: SweepRows, opts: { since: Date; agentCodes?: Map<string, string> }): NotificationEvent[] {
  const inWindow = (d: Date | null): d is Date => !!d && d.getTime() >= opts.since.getTime()
  const out: NotificationEvent[] = []

  // Savings: a Bulk Savings batch is one notification keyed on its first ref; everything else is one per payment.
  const batches = new Map<string, SweepRows['savings']>()
  for (const s of rows.savings) {
    if (!inWindow(s.createdAt)) continue
    const batch = s.note?.startsWith(BULK_NOTE_PREFIX) ? s.note.slice(BULK_NOTE_PREFIX.length) : null
    if (batch) { batches.set(batch, [...(batches.get(batch) ?? []), s]); continue }
    const c = s.plan.customer
    out.push(...at(N.savingsReceived({
      ref: s.ref, customerId: c.id, agentId: c.agentId, customerName: nameOf(c), planGoal: s.plan.goal, amount: s.amount, fee: s.feeTaken,
      onlineTransfer: s.plan.source === 'self' && s.method === 'Transfer',
    }), s.createdAt))
  }
  for (const [ref, days] of batches) {
    const c = days[0].plan.customer
    const sum = (f: (d: SweepRows['savings'][number]) => number) => Math.round(days.reduce((t, d) => t + f(d), 0) * 100) / 100
    out.push(...at(N.savingsReceived({
      ref, customerId: c.id, agentId: c.agentId, customerName: nameOf(c), planGoal: days[0].plan.goal,
      amount: sum(d => d.amount), fee: sum(d => d.feeTaken), onlineTransfer: false,
    }), days[0].createdAt))
  }

  for (const r of rows.collections) {
    const c = r.savingsPlan.customer
    const facts = { id: r.id, customerId: c.id, agentId: c.agentId, customerName: nameOf(c), amount: r.netPayout }
    if (inWindow(r.requestedAt)) out.push(...at(N.collectionRequested({ ...facts, byCustomer: r.ref.startsWith('RED-') }), r.requestedAt))
    if (inWindow(r.agentApprovedAt)) out.push(...at(N.collectionApproved(facts), r.agentApprovedAt))
    if (inWindow(r.decidedAt) && r.status === 'Approved') out.push(...at(N.collectionPaid(facts), r.decidedAt))
    if (inWindow(r.decidedAt) && r.status === 'Rejected') {
      const byAgent = !!r.decidedBy && r.decidedBy === opts.agentCodes?.get(c.agentId)
      out.push(...at(N.collectionDeclined({ ...facts, byAgent, reason: byAgent ? 'Declined by your agent' : null }), r.decidedAt))
    }
  }

  for (const w of rows.withdrawals) {
    if (!inWindow(w.decidedAt)) continue
    if (w.status === 'Approved') out.push(...at(N.withdrawalPaid({ id: w.id, agentId: w.agentId, amount: w.amount }), w.decidedAt))
    if (w.status === 'Rejected') {
      const reason = w.adminNote?.startsWith('Auto-refund') ? 'The bank transfer didn’t go through.' : w.adminNote
      out.push(...at(N.withdrawalDeclined({ id: w.id, agentId: w.agentId, amount: w.amount, reason }), w.decidedAt))
    }
  }

  for (const t of rows.topUps) {
    if (inWindow(t.createdAt)) out.push(...at(N.walletFunded({ agentId: t.agentId, amount: t.amount, ref: t.ref }), t.createdAt))
  }
  return out
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Date-based notices for plans still open (status Active): ending within 7 days, or already ended. */
export function scheduledEvents(
  plans: { id: string; goal: string; customerId: string; agentId: string; maturityDate: Date }[],
  now: Date,
): NotificationEvent[] {
  const out: NotificationEvent[] = []
  const endingByAgent = new Map<string, number>()
  for (const p of plans) {
    const left = p.maturityDate.getTime() - now.getTime()
    if (left <= 0) out.push(...N.planEnded({ planId: p.id, customerId: p.customerId, goal: p.goal }))
    else if (left <= 7 * DAY) {
      out.push(...N.planEndingSoon({ planId: p.id, customerId: p.customerId, goal: p.goal, maturityDate: p.maturityDate }))
      endingByAgent.set(p.agentId, (endingByAgent.get(p.agentId) ?? 0) + 1)
    }
  }
  for (const [agentId, count] of endingByAgent) out.push(...N.agentPlansEndingThisWeek({ agentId, count, dayKey: dayKey(now) }))
  return out
}

/** Writes the events that don't exist yet. Returns how many were new. Short writes, in batches (SQLite, two app processes). */
async function writeMissing(client: PrismaClient, events: NotificationEvent[]): Promise<number> {
  let added = 0
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200)
    const have = new Set((await client.notification.findMany({ where: { dedupeKey: { in: chunk.map(e => e.dedupeKey) } }, select: { dedupeKey: true } })).map(n => n.dedupeKey))
    const missing = chunk.filter(e => !have.has(e.dedupeKey))
    if (missing.length) { await notify(client, missing); added += missing.length }
  }
  return added
}

export async function runNotificationSweep(client: PrismaClient, now: Date = new Date()): Promise<{ backfilled: number; scheduled: number }> {
  const since = new Date(now.getTime() - BACKFILL_HOURS * 3_600_000)
  const cust = { select: { id: true, agentId: true, firstName: true, lastName: true } } as const
  const [savings, collections, withdrawals, topUps, agents] = await Promise.all([
    client.transaction.findMany({
      where: { type: 'saving', status: 'Done', createdAt: { gte: since }, planId: { not: null } },
      select: { ref: true, amount: true, feeTaken: true, method: true, note: true, createdAt: true, plan: { select: { goal: true, source: true, customer: cust } } },
    }),
    client.earlyRedemption.findMany({
      where: { OR: [{ requestedAt: { gte: since } }, { agentApprovedAt: { gte: since } }, { decidedAt: { gte: since } }] },
      select: { id: true, ref: true, status: true, netPayout: true, requestedAt: true, agentApprovedAt: true, decidedAt: true, decidedBy: true, savingsPlan: { select: { customer: cust } } },
    }),
    client.agentWithdrawal.findMany({ where: { decidedAt: { gte: since } }, select: { id: true, agentId: true, amount: true, status: true, adminNote: true, decidedAt: true } }),
    client.transaction.findMany({ where: { type: 'wallet_funding', status: 'Done', createdAt: { gte: since } }, select: { ref: true, agentId: true, amount: true, createdAt: true } }),
    client.agent.findMany({ select: { id: true, agentId: true } }),
  ])
  const rows: SweepRows = {
    savings: savings.flatMap(s => (s.plan ? [{ ...s, plan: s.plan }] : [])),
    collections, withdrawals, topUps,
  }
  const backfilled = await writeMissing(client, backfillEvents(rows, { since, agentCodes: new Map(agents.map(a => [a.id, a.agentId])) }))

  const open = await client.savingsPlan.findMany({
    where: { status: 'Active', maturityDate: { lte: new Date(now.getTime() + 7 * DAY), gte: new Date(now.getTime() - 30 * DAY) } },
    select: { id: true, goal: true, customerId: true, maturityDate: true, customer: { select: { agentId: true } } },
  })
  const scheduled = await writeMissing(client, scheduledEvents(open.map(p => ({ ...p, agentId: p.customer.agentId })), now))

  if (backfilled > 0) {
    logAudit({
      action: 'notifications_backfilled', entity: 'Notification',
      details: `Nightly safety net added ${backfilled} in-app notification(s) that a live path had not written. Check the tripwire and the paths for the last ${BACKFILL_HOURS} hours.`,
      actorType: 'system', actorName: 'Notification safety net',
    })
  }
  return { backfilled, scheduled }
}
