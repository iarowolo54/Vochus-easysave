// Refunding a platform fee that shouldn't have been charged (e.g. a cash first-day fee on a customer who turned out to be
// online). The history is corrected, never rewritten: the deposit keeps its fee, and the refund is its own record:
// a `fee_refund` transaction the customer sees, negative ledger rows that net the agent's and platform's shares out,
// a notification to each side and an audit entry. A deposit can be refunded only once.
import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { money } from '@/lib/money'
import { recordReversal, type LedgerSource } from '@/lib/commission-ledger'
import { notifications, notify } from '@/lib/notifications'

type Tx = Prisma.TransactionClient

const FEE_SOURCES = new Set(['daily_first', 'periodic_fee'])
export const REFUND_SOURCE: LedgerSource = 'fee_refund'

export interface RefundSplit { fee: number; agentShare: number; platformShare: number }

/** The fee and each share, from the deposit's own ledger rows. Throws NOT_REFUNDABLE (no fee) or ALREADY_REFUNDED. */
export function refundSplit(rows: { party: string; source: string; amount: number }[]): RefundSplit {
  if (rows.some(r => r.source === REFUND_SOURCE)) throw new Error('ALREADY_REFUNDED')
  const fees = rows.filter(r => FEE_SOURCES.has(r.source))
  const agentShare = money(fees.filter(r => r.party === 'agent').reduce((t, r) => t + r.amount, 0))
  const platformShare = money(fees.filter(r => r.party === 'platform').reduce((t, r) => t + r.amount, 0))
  const fee = money(agentShare + platformShare)
  if (!(fee > 0)) throw new Error('NOT_REFUNDABLE')
  return { fee, agentShare, platformShare }
}

const NOTE_PREFIX = 'Refund of the fee on '

/** The refund transaction's note: which deposit it undoes, and why. */
export function refundNote(depositRef: string, reason: string): string {
  return `${NOTE_PREFIX}${depositRef}. ${reason}`.trim()
}

/** The deposit a refund note points at, or null for any other note. */
export function depositRefOf(note: string | null | undefined): string | null {
  if (!note?.startsWith(NOTE_PREFIX)) return null
  const m = /^(\S+?)\.(\s|$)/.exec(note.slice(NOTE_PREFIX.length))
  return m ? m[1] : null
}

export interface RefundFacts {
  deposit: { ref: string; agentId: string; customerId: string; planId: string }
  planGoal: string
  customerName: string
  split: RefundSplit
  reason: string
  actorName: string
}

/**
 * Writes the refund's records. With `moveMoney`, it also credits the plan and takes each share back. Without it, the
 * money already moved (the repair of hand refunds made before this existed). Throws PLAN_CLOSED, AGENT_BALANCE_LOW or
 * REVENUE_LOW, and the caller's transaction rolls back.
 */
export async function writeRefundRecords(tx: Tx, f: RefundFacts, opts: { moveMoney: boolean; at?: Date }): Promise<{ ref: string }> {
  const at = opts.at ?? new Date()
  const { fee, agentShare, platformShare } = f.split
  if (opts.moveMoney) {
    // Only an open plan can take the money back; a redeemed plan's balance has already been paid out.
    const credited = await tx.savingsPlan.updateMany({ where: { id: f.deposit.planId, status: 'Active' }, data: { balance: { increment: fee } } })
    if (credited.count !== 1) throw new Error('PLAN_CLOSED')
    if (agentShare > 0) {
      const back = await tx.agent.updateMany({ where: { id: f.deposit.agentId, commissionBalance: { gte: agentShare } }, data: { commissionBalance: { decrement: agentShare } } })
      if (back.count !== 1) throw new Error('AGENT_BALANCE_LOW')
    }
    if (platformShare > 0) {
      const back = await tx.platformWallet.updateMany({ where: { type: 'Revenue', balance: { gte: platformShare } }, data: { balance: { decrement: platformShare } } })
      if (back.count !== 1) throw new Error('REVENUE_LOW')
    }
  }

  const ref = `FRF-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`
  const base = { source: REFUND_SOURCE, sourceRef: f.deposit.ref, customerId: f.deposit.customerId, base: fee, createdAt: at }
  // Keyed on the deposit's ref, so a second refund of the same deposit is refused here as well as by refundSplit.
  const wroteAgent = agentShare > 0
    ? await recordReversal(tx, { ...base, party: 'agent', agentId: f.deposit.agentId, ratePct: money((agentShare / fee) * 100), amount: agentShare })
    : true
  const wrotePlatform = platformShare > 0
    ? await recordReversal(tx, { ...base, party: 'platform', agentId: null, ratePct: money((platformShare / fee) * 100), amount: platformShare })
    : true
  if (!wroteAgent || !wrotePlatform) throw new Error('ALREADY_REFUNDED')

  await tx.transaction.create({
    data: {
      ref, agentId: f.deposit.agentId, customerId: f.deposit.customerId, planId: f.deposit.planId,
      // notify: feeRefunded
      type: 'fee_refund', amount: fee, method: 'Adjustment', status: 'Done', note: refundNote(f.deposit.ref, f.reason), createdAt: at,
    },
  })
  await notify(tx, notifications.feeRefunded({
    ref, customerId: f.deposit.customerId, agentId: f.deposit.agentId, customerName: f.customerName, planGoal: f.planGoal, fee, agentShare,
  }).map(e => ({ ...e, at })))
  await tx.auditLog.create({
    data: {
      action: 'cash_fee_refunded', entity: 'SavingsPlan', entityId: f.deposit.planId, actorType: 'admin', actorName: f.actorName,
      details: `${f.customerName}: fee of ${fee} on ${f.deposit.ref} refunded as ${ref} (agent ${agentShare}, platform ${platformShare})${opts.moveMoney ? '' : ', records only: the money had already been moved'}. ${f.reason}`,
    },
  })
  return { ref }
}

/** Refunds one deposit's fee in full: loads its ledger rows, works out the split, moves the money and writes the records. */
export async function refundCashFee(tx: Tx, i: { depositTxnId: string; reason: string; actorName: string }): Promise<{ ref: string } & RefundSplit> {
  const dep = await tx.transaction.findUnique({
    where: { id: i.depositTxnId },
    select: { ref: true, type: true, agentId: true, customerId: true, planId: true, feeTaken: true, plan: { select: { goal: true } }, customer: { select: { firstName: true, lastName: true } } },
  })
  if (!dep || dep.type !== 'saving' || !dep.customerId || !dep.planId || !dep.plan || !dep.customer) throw new Error('NOT_REFUNDABLE')
  const rows = await tx.commissionLedger.findMany({ where: { sourceRef: dep.ref }, select: { party: true, source: true, amount: true } })
  const split = refundSplit(rows)
  if (money(split.fee) !== money(dep.feeTaken)) throw new Error('NOT_REFUNDABLE')
  const { ref } = await writeRefundRecords(tx, {
    deposit: { ref: dep.ref, agentId: dep.agentId, customerId: dep.customerId, planId: dep.planId },
    planGoal: dep.plan.goal, customerName: `${dep.customer.firstName} ${dep.customer.lastName}`, split, reason: i.reason, actorName: i.actorName,
  }, { moveMoney: true })
  return { ref, ...split }
}
