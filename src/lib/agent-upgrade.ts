// Customer → agent conversion. An agent sends the details of one of their online customers; the office approves or
// turns it down from those details and the savings history. Approval CONVERTS the person: one person, one role. The
// customer record is closed (status 'Converted', kept as history) and a new agent account takes over its phone, email
// and password. Documents are private, so the agent never sends them: the new agent uploads their own after approval,
// and until the office approves them the agent app only opens the Documents screen (src/app/dashboard/layout.tsx).
// Everything that decides a request lives here so the agent and admin routes can't drift apart.
import type { Prisma, PrismaClient } from '@prisma/client'
import { validateLga, validateState } from '@/lib/customer-fields'
import { findIdentityConflict } from '@/lib/identity'
import { notifications, notify } from '@/lib/notifications'
import { normalizePhone } from '@/lib/phone'
import { AWAITING_ACTION_REDEMPTION_STATUSES, excludeExpiredPending } from '@/lib/redemption-statuses'
import { ACTIVE_LOAN_STATUSES } from '@/lib/loan-eligibility'
import { formatNaira } from '@/lib/format'

/** The documents every new agent must upload and have approved, as for agents invited today. The bank statement stays optional. */
export const NEW_AGENT_REQUIRED_DOCS = ['id', 'addr', 'guar', 'agree'] as const
export const CONVERTED = 'Converted'
/** A plan of a converted customer. Not 'Active', so no deposit path can credit it. */
export const PLAN_CLOSED_ON_CONVERSION = 'Closed'

export type UpgradeStatus = 'Pending' | 'Approved' | 'Denied'

export interface UpgradeFields { nin: string; bvn: string | null; state: string; lga: string; address: string; nokName: string; nokPhone: string }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; blockers?: string[] }
type Admin = { id?: string; name: string; type: 'superadmin' | 'staff' }
type Db = PrismaClient | Prisma.TransactionClient

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const nameOf = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`
const EPS = 0.005

/** The details the agent sends. No documents: those are the customer's own to upload after approval. */
export function parseUpgradeBody(body: unknown): Parsed<UpgradeFields> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Fill in the form.' }
  const b = body as Record<string, unknown>
  const nin = text(b.nin, 20)
  if (!/^\d{11}$/.test(nin)) return { ok: false, error: 'Enter the 11-digit NIN.' }
  const bvn = text(b.bvn, 20)
  if (bvn && !/^\d{11}$/.test(bvn)) return { ok: false, error: 'The BVN has 11 digits. Leave it empty if they don’t have it.' }
  const state = validateState(b.state)
  if (!state.ok) return { ok: false, error: state.error }
  const lga = validateLga(state.value, b.lga)
  if (!lga.ok) return { ok: false, error: lga.error }
  const address = text(b.address, 300)
  if (address.length < 5) return { ok: false, error: 'Enter their home address.' }
  const nokName = text(b.nokName, 100)
  if (nokName.length < 2) return { ok: false, error: 'Enter the next of kin’s name.' }
  const nokPhone = normalizePhone(text(b.nokPhone, 20))
  if (!/^0\d{10}$/.test(nokPhone)) return { ok: false, error: 'Enter the next of kin’s 11-digit phone number.' }
  return { ok: true, value: { nin, bvn: bvn || null, state: state.value, lga: lga.value, address, nokName, nokPhone } }
}

/** Who can be converted at all. Online customers only; nothing locked, closed or already converted. */
export function eligibilityError(c: { type: string; status: string; convertedToAgentId: string | null; password: string | null }): string | null {
  if (c.convertedToAgentId || c.status === CONVERTED) return 'This customer is already an agent.'
  if (c.type !== 'online') return 'Only online customers can become agents.'
  if (c.status !== 'Active') return 'This customer’s account isn’t active.'
  if (!c.password) return 'This customer hasn’t finished setting up their account.'
  return null
}

/**
 * Everything that would be left behind on a closed customer account: money held, payouts or deposits in flight, a loan,
 * an Ajo group. Each is a plain sentence the agent can act on. Empty = safe to convert. Run inside the approval
 * transaction too, so nothing can slip in between the check and the conversion.
 */
export async function findBlockers(client: Db, customerId: string, now: Date = new Date()): Promise<string[]> {
  const [c, plans, redemption, loan, ajo, transfer] = await Promise.all([
    client.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } }),
    client.savingsPlan.findMany({ where: { customerId }, select: { goal: true, balance: true, interestAccrued: true, status: true } }),
    client.earlyRedemption.findFirst({ where: { savingsPlan: { customerId }, status: { in: AWAITING_ACTION_REDEMPTION_STATUSES }, ...excludeExpiredPending(now) }, select: { id: true } }),
    client.loan.findFirst({ where: { customerId, status: { in: [...ACTIVE_LOAN_STATUSES] } }, select: { id: true } }),
    client.ajoMember.findFirst({ where: { customerId, replacedAt: null, group: { status: { in: ['Forming', 'Running'] } } }, select: { group: { select: { name: true } } } }),
    client.paymentIntent.findFirst({ where: { customerId, status: 'Pending', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } }),
  ])
  const out: string[] = []
  if (c && c.walletBalance > EPS) out.push(`${formatNaira(c.walletBalance)} is in their wallet.`)
  for (const p of plans) {
    if (p.balance > EPS) out.push(`${formatNaira(p.balance)} is saved in “${p.goal}”. Redeem it first.`)
    else if (p.interestAccrued > EPS && p.status !== 'Redeemed') out.push(`“${p.goal}” has interest waiting. Redeem it first.`)
  }
  if (redemption) out.push('A redemption is still being processed.')
  if (loan) out.push('They have a loan that isn’t finished.')
  if (ajo) out.push(`They’re in the Ajo group “${ajo.group.name}”, which hasn’t finished.`)
  if (transfer) out.push('A bank transfer they started is still waiting to be matched.')
  return out
}

/** The next AGT number after the highest real one. Never a count (a count repeats once an agent is deleted). */
export function nextAgentCode(rows: { agentId: string }[]): string {
  const max = rows.reduce((m, r) => {
    const n = /^AGT-(\d+)$/.exec(r.agentId)
    return n ? Math.max(m, parseInt(n[1], 10)) : m
  }, 0)
  return `AGT-${String(max + 1).padStart(5, '0')}`
}

/** Unique-index race on pendingCustomerId: someone else opened a request for this customer first. */
export function isOpenRequestConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  return err?.code === 'P2002' && String(err.meta?.target ?? '').includes('pendingCustomerId')
}
const OPEN_CONFLICT = 'This customer already has an upgrade waiting.'

/** Where a new agent stands with the documents they must upload: none sent, some waiting, all approved. */
export function documentsState(required: string[], docs: { docType: string; docApprovalStatus: string }[]): 'missing' | 'review' | 'rejected' | 'approved' {
  const of = (t: string) => docs.find(d => d.docType === t)?.docApprovalStatus
  if (required.every(t => of(t) === 'approved')) return 'approved'
  if (required.some(t => of(t) === 'rejected')) return 'rejected'
  if (required.every(t => of(t))) return 'review'
  return 'missing'
}

class Stop extends Error {
  constructor(readonly status: number, message: string, readonly blockers?: string[]) { super(message) }
}
const stopResult = (e: unknown) => {
  if (e instanceof Stop) return { ok: false as const, status: e.status, error: e.message, ...(e.blockers ? { blockers: e.blockers } : {}) }
  if (isOpenRequestConflict(e)) return { ok: false as const, status: 409, error: OPEN_CONFLICT }
  throw e
}

export type SubmittedInfo = { id: string; customerName: string }

/** The agent sends the details. Only for their own online customer with nothing left open; it goes straight to the office. */
export async function submitUpgradeRequest(client: PrismaClient, input: { agent: { id: string; name: string }; customerId: string; fields: UpgradeFields }, now: Date = new Date()): Promise<Result<SubmittedInfo>> {
  const c = await client.customer.findFirst({
    where: { id: input.customerId, agentId: input.agent.id },
    select: { id: true, firstName: true, lastName: true, type: true, status: true, convertedToAgentId: true, password: true },
  })
  if (!c) return { ok: false, status: 404, error: 'Customer not found.' }
  const notEligible = eligibilityError(c)
  if (notEligible) return { ok: false, status: 400, error: notEligible }
  const blockers = await findBlockers(client, c.id, now)
  if (blockers.length) return { ok: false, status: 409, error: 'Some things must be finished before they can become an agent.', blockers }

  try {
    const id = await client.$transaction(async tx => {
      // notify: none — the agent is on the screen that confirms it; the office is told by email
      const r = await tx.agentUpgradeRequest.create({
        data: { customerId: c.id, agentId: input.agent.id, status: 'Pending', pendingCustomerId: c.id, submittedAt: now, ...input.fields },
        select: { id: true },
      })
      await tx.auditLog.create({ data: { action: 'agent_upgrade_submitted', entity: 'AgentUpgradeRequest', entityId: r.id, actorType: 'agent', actorId: input.agent.id, actorName: input.agent.name, details: `Asked for ${nameOf(c)} to become an agent` } })
      return r.id
    })
    return { ok: true, id, customerName: nameOf(c) }
  } catch (e) {
    return stopResult(e)
  }
}

/** The agent fixes a turned-down request and sends it again. */
export async function resubmitUpgradeRequest(client: PrismaClient, input: { agent: { id: string; name: string }; id: string; fields: UpgradeFields }, now: Date = new Date()): Promise<Result<{ customerName: string }>> {
  const r = await client.agentUpgradeRequest.findFirst({
    where: { id: input.id, agentId: input.agent.id },
    select: { id: true, status: true, customer: { select: { id: true, firstName: true, lastName: true, type: true, status: true, convertedToAgentId: true, password: true, agentId: true } } },
  })
  if (!r || r.customer.agentId !== input.agent.id) return { ok: false, status: 404, error: 'Request not found.' }
  if (r.status !== 'Denied') return { ok: false, status: 409, error: 'Only a request that wasn’t approved can be sent again.' }
  const notEligible = eligibilityError(r.customer)
  if (notEligible) return { ok: false, status: 400, error: notEligible }
  const blockers = await findBlockers(client, r.customer.id, now)
  if (blockers.length) return { ok: false, status: 409, error: 'Some things must be finished before they can become an agent.', blockers }

  try {
    await client.$transaction(async tx => {
      // notify: none — the agent is on the screen that confirms it; the office is told by email
      const claimed = await tx.agentUpgradeRequest.updateMany({
        where: { id: r.id, status: 'Denied' },
        data: { status: 'Pending', pendingCustomerId: r.customer.id, submittedAt: now, ...input.fields },
      })
      if (claimed.count !== 1) throw new Stop(409, 'Only a request that wasn’t approved can be sent again.')
      await tx.auditLog.create({ data: { action: 'agent_upgrade_resubmitted', entity: 'AgentUpgradeRequest', entityId: r.id, actorType: 'agent', actorId: input.agent.id, actorName: input.agent.name, details: `Sent the upgrade for ${nameOf(r.customer)} again` } })
    })
    return { ok: true, customerName: nameOf(r.customer) }
  } catch (e) {
    return stopResult(e)
  }
}

export type ApprovedInfo = { newAgentCode: string; customerName: string; email: string | null; requester: { name: string; email: string | null } }

/**
 * Approval converts the person, all or nothing: claims the request, re-checks that nothing is left open, creates the
 * agent with the customer's phone, email and password and today's required documents (none on file yet), closes the
 * customer account (ending every session) and its plans, cancels auto-debits, and records it all.
 */
export async function approveUpgradeRequest(client: PrismaClient, input: { id: string; admin: Admin }, now: Date = new Date()): Promise<Result<ApprovedInfo>> {
  try {
    const out = await client.$transaction(async tx => {
      // Claiming first also takes SQLite's write lock, so the checks below and the AGT number can't race another write.
      // notify: agentUpgradeApproved
      const claimed = await tx.agentUpgradeRequest.updateMany({
        where: { id: input.id, status: 'Pending' },
        data: { status: 'Approved', decidedAt: now, decidedBy: input.admin.name, decidedById: input.admin.id ?? null, pendingCustomerId: null, denyReason: null, denyFix: null },
      })
      if (claimed.count !== 1) throw new Stop(409, 'This request isn’t waiting for a decision.')
      const r = await tx.agentUpgradeRequest.findUniqueOrThrow({
        where: { id: input.id },
        include: { agent: { select: { id: true, name: true, email: true } }, customer: true },
      })
      const c = r.customer
      const notEligible = eligibilityError(c)
      if (notEligible) throw new Stop(409, `${notEligible} Turn the request down.`)
      const blockers = await findBlockers(tx, c.id, now)
      if (blockers.length) throw new Stop(409, 'Things are still open on this customer’s account. Ask the agent to finish them, or turn the request down.', blockers)
      // The phone and email move from the customer to the agent, so only someone else holding them is a conflict.
      const conflict = await findIdentityConflict(tx, { phone: c.phone, email: c.email }, { excludeCustomerId: c.id })
      if (conflict) throw new Stop(409, `This ${conflict === 'phone' ? 'phone number' : 'email'} belongs to another account. Turn the request down.`)

      const agentCode = nextAgentCode(await tx.agent.findMany({ select: { agentId: true } }))
      const customerName = nameOf(c)
      const newAgent = await tx.agent.create({
        data: {
          agentId: agentCode, name: customerName, phone: c.phone, email: c.email, emailVerified: !!c.emailVerifiedAt,
          location: `${r.state}, ${r.lga}`, address: r.address, dob: c.dob ? c.dob.toISOString().slice(0, 10) : null, gender: c.gender,
          bvn: r.bvn ?? c.bvn, nin: r.nin, nokName: r.nokName, nokPhone: r.nokPhone, photoUrl: c.photoUrl,
          password: c.password ?? '', walletBalance: 0, status: 'Active', requiredDocs: JSON.stringify(NEW_AGENT_REQUIRED_DOCS), fromCustomerId: c.id,
        },
        select: { id: true },
      })
      await tx.customer.update({
        where: { id: c.id },
        data: { status: CONVERTED, convertedToAgentId: newAgent.id, convertedAt: now, tokenVersion: { increment: 1 }, boundDeviceId: null },
      })
      await tx.biometricToken.updateMany({ where: { customerId: c.id, revokedAt: null }, data: { revokedAt: now } })
      await tx.savingsPlan.updateMany({ where: { customerId: c.id, status: 'Active' }, data: { status: PLAN_CLOSED_ON_CONVERSION } })
      await tx.autoDebitMandate.updateMany({ where: { customerId: c.id, status: { not: 'cancelled' } }, data: { status: 'cancelled' } })
      // notify: agentUpgradeApproved
      await tx.agentUpgradeRequest.update({ where: { id: r.id }, data: { createdAgentId: newAgent.id } })
      await notify(tx, notifications.agentUpgradeApproved({ id: r.id, agentId: r.agentId, newAgentId: newAgent.id, customerName, newAgentCode: agentCode }))
      await tx.auditLog.createMany({
        data: [
          { action: 'agent_upgrade_approved', entity: 'AgentUpgradeRequest', entityId: r.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name, details: `Approved ${customerName} (${c.customerId}) as agent ${agentCode}, asked for by ${r.agent.name}` },
          { action: 'customer_converted_to_agent', entity: 'Customer', entityId: c.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name, details: `${customerName} (${c.customerId}) became agent ${agentCode}. Customer account closed and kept as history; plans closed, auto-debits cancelled, all sessions ended. Documents still to be uploaded by the new agent.` },
          { action: 'agent', entity: 'Agent', entityId: newAgent.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name, details: `Agent created — ${customerName} (${agentCode}) from customer ${c.customerId}` },
        ],
      })
      return { newAgentCode: agentCode, customerName, email: c.emailVerifiedAt ? c.email : null, requester: { name: r.agent.name, email: r.agent.email } }
    }, { maxWait: 10_000, timeout: 20_000 })
    return { ok: true, ...out }
  } catch (e) {
    return stopResult(e)
  }
}

export type DeniedInfo = { customerName: string; requester: { email: string | null } }

/** Turned down with a reason and what to fix. The customer is untouched and was never told; no money moves. */
export async function denyUpgradeRequest(client: PrismaClient, input: { id: string; admin: Admin; reason: string; fix: string }, now: Date = new Date()): Promise<Result<DeniedInfo>> {
  const r = await client.agentUpgradeRequest.findUnique({
    where: { id: input.id },
    select: { id: true, agentId: true, agent: { select: { email: true } }, customer: { select: { firstName: true, lastName: true } } },
  })
  if (!r) return { ok: false, status: 404, error: 'Request not found.' }
  const customerName = nameOf(r.customer)
  const done = await client.$transaction(async tx => {
    // notify: agentUpgradeDenied
    const claimed = await tx.agentUpgradeRequest.updateMany({
      where: { id: r.id, status: 'Pending' },
      data: { status: 'Denied', decidedAt: now, decidedBy: input.admin.name, decidedById: input.admin.id ?? null, denyReason: input.reason, denyFix: input.fix, pendingCustomerId: null },
    })
    if (claimed.count !== 1) return false
    await notify(tx, notifications.agentUpgradeDenied({ id: r.id, agentId: r.agentId, customerName, decidedAt: now }))
    await tx.auditLog.create({ data: { action: 'agent_upgrade_denied', entity: 'AgentUpgradeRequest', entityId: r.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name, details: `Turned down ${customerName} as an agent. Reason: ${input.reason}. To work on: ${input.fix}` } })
    return true
  })
  if (!done) return { ok: false, status: 409, error: 'This request isn’t waiting for a decision.' }
  return { ok: true, customerName, requester: { email: r.agent.email } }
}

/** What the office weighs: how long they've saved, how much, how steadily, and how their plans ended. */
export async function savingsSummary(client: Db, customerId: string, now: Date = new Date()) {
  const since90 = new Date(now.getTime() - 90 * 86_400_000)
  const [c, plans, savings, redemptions] = await Promise.all([
    client.customer.findUnique({ where: { id: customerId }, select: { createdAt: true } }),
    client.savingsPlan.findMany({ where: { customerId }, orderBy: { startDate: 'desc' }, select: { id: true, goal: true, status: true, cadence: true, dailyAmount: true, periodDays: true, balance: true, startDate: true, maturityDate: true } }),
    client.transaction.findMany({ where: { customerId, type: 'saving', status: 'Done' }, orderBy: { createdAt: 'desc' }, select: { ref: true, amount: true, method: true, createdAt: true, planId: true, paidByAgentId: true } }),
    client.earlyRedemption.findMany({ where: { savingsPlan: { customerId } }, orderBy: { requestedAt: 'desc' }, select: { ref: true, type: true, status: true, netPayout: true, penalty: true, requestedAt: true } }),
  ])
  const days90 = new Set(savings.filter(s => s.createdAt >= since90).map(s => s.createdAt.toISOString().slice(0, 10)))
  return {
    accountAgeDays: c ? Math.floor((now.getTime() - c.createdAt.getTime()) / 86_400_000) : 0,
    totalSaved: Math.round(savings.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    savingsCount: savings.length,
    firstSavingAt: savings.at(-1)?.createdAt ?? null,
    lastSavingAt: savings[0]?.createdAt ?? null,
    daysSavedLast90: days90.size,
    plansByStatus: plans.reduce<Record<string, number>>((m, p) => ({ ...m, [p.status]: (m[p.status] ?? 0) + 1 }), {}),
    earlyRedemptions: redemptions.filter(r => r.type === 'early' && !['Rejected', 'Declined'].includes(r.status)).length,
    plans,
    savings: savings.slice(0, 200),
    redemptions,
  }
}
