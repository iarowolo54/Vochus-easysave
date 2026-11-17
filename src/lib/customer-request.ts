// Agent registration of cash savers: a submission is a request, and only the super admin's approval makes it a customer.
// Everything that decides a request lives here so the agent and admin routes can't drift apart.
import type { PrismaClient } from '@prisma/client'
import { genTxnRef } from '@/lib/ref'
import { validateDob, validateGender, validateLga, validateState } from '@/lib/customer-fields'
import { BAD_CADENCE, flexiblePlanData, isFlexible, parseCadence, type FlexibleSettings, type PlanCadence } from '@/lib/flexible-savings'
import { getFlexibleSettings } from '@/lib/flexible-savings'
import { findIdentityConflict } from '@/lib/identity'
import { notifications, notify } from '@/lib/notifications'
import { normalizePhone } from '@/lib/phone'
import { normalizeEmail } from '@/lib/email'
import { validatePhoto } from '@/lib/photo'
import { addDays, daysBetween, isoDate, MAX_PLAN_DAYS, parseDateInput } from '@/lib/plan-dates'
import { formatNaira } from '@/lib/format'
import { REGISTRATION_CARD_COST, REGISTRATION_FEE } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'

/** Fixed plans keep the daily equivalent the plan table stores; flexible plans carry a chosen end date instead. */
export interface RequestPlan {
  dailyAmount: number
  periodDays: number
  goal: string
  cadence: PlanCadence
  startDate: string
  endDate: string | null
  notes: string | null
}

export interface RequestFields {
  firstName: string
  lastName: string
  phone: string
  email: string | null
  dob: Date | null
  address: string
  language: string
  gender: string
  state: string
  lga: string
  bvn: string | null
  nokName: string
  nokRelation: string
  nokPhone: string
  photoUrl: string
  plans: string
  nfcCard: string | null
  registrationFee: number
  pendingPhone: string
  pendingEmail: string | null
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
export type DecisionResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string }

const MAX_PLANS = 10
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const fullName = (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`

/** A plan whose start date has passed while its request waited starts today instead, and keeps its full length. */
export function rollForward(plan: RequestPlan, now: Date): RequestPlan {
  const start = parseDateInput(plan.startDate)
  const todayStart = midnight(now)
  if (!start || start.getTime() >= todayStart.getTime()) return plan
  const behind = daysBetween(start, todayStart)
  const end = plan.endDate ? parseDateInput(plan.endDate) : null
  return { ...plan, startDate: isoDate(todayStart), endDate: end ? isoDate(addDays(end, behind)) : plan.endDate }
}

/** The SavingsPlan fields for a request's plan, or why the plan can't be opened. */
export function planRow(plan: RequestPlan, flex: FlexibleSettings, now: Date) {
  const p = rollForward(plan, now)
  const start = parseDateInput(p.startDate)
  if (!start) return { error: 'A plan’s start date is not a real date.' }
  if (isFlexible(p.cadence)) {
    const r = flexiblePlanData({ startDate: p.startDate, endDate: p.endDate }, flex, now)
    return 'error' in r ? { error: r.error } : { ...r, goal: p.goal, notes: p.notes }
  }
  return {
    dailyAmount: p.dailyAmount,
    periodDays: p.periodDays,
    cadence: p.cadence,
    startDate: start,
    maturityDate: addDays(start, p.periodDays),
    goal: p.goal,
    notes: p.notes,
  }
}

function parsePlan(raw: unknown, flex: FlexibleSettings, now: Date): Parsed<RequestPlan> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cadence = parseCadence(p.cadence)
  if (!cadence) return { ok: false, error: BAD_CADENCE }
  const goal = text(p.goal, 80)
  if (!goal) return { ok: false, error: 'Say what each plan is saving for.' }
  const startRaw = text(p.startDate, 10)
  if (startRaw && !parseDateInput(startRaw)) return { ok: false, error: 'A plan’s start date is not a real date.' }
  const flexible = isFlexible(cadence)
  const dailyAmount = flexible ? 0 : Number(p.dailyAmount)
  const periodDays = flexible ? 0 : Number(p.periodDays)
  if (!flexible && !(Number.isFinite(dailyAmount) && dailyAmount > 0)) return { ok: false, error: 'Enter an amount for each plan.' }
  if (!flexible && !(Number.isInteger(periodDays) && periodDays > 0 && periodDays <= MAX_PLAN_DAYS)) return { ok: false, error: 'Choose how long each plan runs.' }
  const plan = rollForward({
    dailyAmount, periodDays, goal, cadence,
    startDate: startRaw || isoDate(now),
    endDate: flexible ? text(p.endDate, 10) : null,
    notes: text(p.notes, 200) || null,
  }, now)
  const row = planRow(plan, flex, now)
  if ('error' in row) return { ok: false, error: row.error ?? 'That plan can’t be opened.' }
  return { ok: true, value: plan }
}

/** Checks a submission field by field. Only the fields named here reach the database. */
export function parseRequestBody(body: unknown, flex: FlexibleSettings, now: Date = new Date()): Parsed<RequestFields> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const firstName = text(b.firstName, 60)
  const lastName = text(b.lastName, 60)
  const address = text(b.address, 200)
  if (!firstName || !lastName) return { ok: false, error: 'Enter their first and last name.' }
  if (!address) return { ok: false, error: 'Enter their home address.' }

  const phoneDigits = text(b.phone, 20).replace(/\D/g, '')
  if (phoneDigits.length !== 11) return { ok: false, error: 'Phone numbers have 11 digits.' }
  const phone = normalizePhone(phoneDigits)

  const emailRaw = text(b.email, 120)
  if (emailRaw && !/^\S+@\S+\.\S+$/.test(emailRaw)) return { ok: false, error: 'That email address doesn’t look right.' }
  const email = emailRaw ? normalizeEmail(emailRaw) : null

  const gender = validateGender(b.gender)
  if (!gender.ok) return { ok: false, error: gender.error }
  const state = validateState(b.state)
  if (!state.ok) return { ok: false, error: state.error }
  const lga = validateLga(state.value, b.lga)
  if (!lga.ok) return { ok: false, error: lga.error }

  if (typeof b.photoUrl !== 'string' || !b.photoUrl) return { ok: false, error: 'Add a passport photograph of the customer.' }
  const photo = validatePhoto(b.photoUrl)
  if (!photo.ok) return { ok: false, error: photo.error }

  const dobCheck = validateDob(text(b.dob, 10), now)
  if (!dobCheck.ok) return { ok: false, error: dobCheck.error }
  const dob = dobCheck.value

  if (!Array.isArray(b.plans) || b.plans.length === 0) return { ok: false, error: 'Add at least one savings plan.' }
  if (b.plans.length > MAX_PLANS) return { ok: false, error: `A customer can start with at most ${MAX_PLANS} plans.` }
  const plans: RequestPlan[] = []
  for (let i = 0; i < b.plans.length; i++) {
    const r = parsePlan(b.plans[i], flex, now)
    if (!r.ok) return { ok: false, error: b.plans.length > 1 ? `Plan ${i + 1}: ${r.error}` : r.error }
    plans.push(r.value)
  }

  return {
    ok: true,
    value: {
      firstName, lastName, phone, email, dob, address,
      language: text(b.language, 30) || 'English',
      gender: gender.value!, state: state.value!, lga: lga.value!,
      bvn: text(b.bvn, 20) || null,
      nokName: text(b.nokName, 120),
      nokRelation: text(b.nokRelation, 30),
      nokPhone: text(b.nokPhone, 20),
      photoUrl: b.photoUrl,
      plans: JSON.stringify(plans),
      nfcCard: text(b.nfcCard, 64) || null,
      registrationFee: REGISTRATION_FEE, // the server's figure; the browser doesn't get a say
      pendingPhone: phone,
      pendingEmail: email,
    },
  }
}

export function parseStoredPlans(raw: string): RequestPlan[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as RequestPlan[]) : []
  } catch {
    return []
  }
}

/** The friendly answer when a waiting request already holds this phone or email (the unique columns are the real guard). */
export function pendingConflictMessage(e: unknown): string | null {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return null
  return String(err.meta?.target ?? '').includes('pendingEmail')
    ? 'A request with this email is already waiting for approval.'
    : 'A request with this phone number is already waiting for approval.'
}

/** The next CST number after the highest real one in these rows, which arrive highest first. Anything not CST-<digits> is skipped. */
export function nextCustomerCode(rows: { customerId: string }[]): string {
  const last = rows.find(r => /^CST-\d+$/.test(r.customerId))
  const lastNum = last ? parseInt(last.customerId.slice(4), 10) : 0
  return `CST-${String(lastNum + 1).padStart(5, '0')}`
}

class Stop extends Error {
  constructor(readonly status: number, message: string, readonly noFunds = false) { super(message) }
}

type Admin = { id?: string; name: string; type: 'superadmin' | 'staff' }
export type ApprovedInfo = { customerCode: string; cardLinked: boolean; hadCard: boolean; customerName: string; fee: number; agent: { email: string | null; name: string }; customer: { firstName: string; phone: string } }

/** Approval: creates the customer, plans and card link and takes the fee, all or nothing. */
export async function approveCustomerRequest(client: PrismaClient, input: { id: string; admin: Admin }, now: Date = new Date()): Promise<DecisionResult<ApprovedInfo>> {
  const r = await client.customerRequest.findUnique({
    where: { id: input.id },
    include: { agent: { select: { id: true, name: true, email: true } } },
  })
  if (!r) return { ok: false, status: 404, error: 'Request not found.' }
  if (r.status !== 'Pending') return { ok: false, status: 409, error: 'This request has already been decided.' }

  const conflict = await findIdentityConflict(client, { phone: r.phone, email: r.email })
  if (conflict) return { ok: false, status: 409, error: `This ${conflict === 'phone' ? 'phone number' : 'email'} now belongs to another account. Deny the request and tell the agent.` }

  const flex = await getFlexibleSettings(client)
  const plans = parseStoredPlans(r.plans)
  const rows = plans.map(p => planRow(p, flex, now))
  const bad = rows.find(row => 'error' in row)
  if (bad || rows.length === 0) return { ok: false, status: 400, error: `${bad && 'error' in bad ? bad.error : 'This request has no plan.'} Deny the request so the agent can fix it.` }

  const customerName = fullName(r)
  const fee = r.registrationFee
  try {
    const out = await client.$transaction(async tx => {
      // Claiming the row first also takes SQLite's write lock, so the CST number below can't be handed out twice.
      // notify: customerRequestApproved
      const claimed = await tx.customerRequest.updateMany({
        where: { id: r.id, status: 'Pending' },
        data: { status: 'Approved', decidedAt: now, decidedBy: input.admin.name, decidedById: input.admin.id ?? null, pendingPhone: null, pendingEmail: null, denyReason: null, denyFix: null },
      })
      if (claimed.count !== 1) throw new Stop(409, 'This request has already been decided.')

      const debited = await tx.agent.updateMany({ where: { id: r.agentId, walletBalance: { gte: fee } }, data: { walletBalance: { decrement: fee } } })
      if (debited.count !== 1) throw new Stop(409, `${r.agent.name}’s wallet doesn’t have the ${formatNaira(fee, { minor: false })} fee. They’ve been asked to top up. Approve it once they have.`, true)

      const customerCode = nextCustomerCode(await tx.customer.findMany({ where: { customerId: { startsWith: 'CST-' } }, orderBy: { customerId: 'desc' }, take: 50, select: { customerId: true } }))

      const customer = await tx.customer.create({
        data: {
          customerId: customerCode, agentId: r.agentId, type: 'offline', // registered by an agent
          firstName: r.firstName, lastName: r.lastName, phone: r.phone, email: r.email, dob: r.dob, address: r.address,
          language: r.language, gender: r.gender, state: r.state, lga: r.lga, bvn: r.bvn,
          nokName: r.nokName, nokRelation: r.nokRelation, nokPhone: r.nokPhone, photoUrl: r.photoUrl,
        },
      })

      let firstPlanId = ''
      for (const row of rows) {
        if ('error' in row) continue
        const plan = await tx.savingsPlan.create({ data: { customerId: customer.id, ...row, balance: 0, notes: row.notes ?? null } })
        firstPlanId ||= plan.id
      }

      await tx.transaction.create({ data: { ref: genTxnRef('ENR'), agentId: r.agentId, customerId: customer.id, planId: firstPlanId, type: 'enrolment', amount: 0, method: 'Cash', status: 'Done' } })
      await tx.transaction.create({ data: { ref: genTxnRef('REG'), agentId: r.agentId, customerId: customer.id, planId: firstPlanId, type: 'registration', amount: fee, method: 'Wallet', status: 'Done' } })

      const cardCost = money(Math.min(REGISTRATION_CARD_COST, fee))
      const revenue = money(fee - cardCost)
      await tx.platformWallet.upsert({ where: { type: 'CardCost' }, update: { balance: { increment: cardCost } }, create: { type: 'CardCost', balance: cardCost } })
      await tx.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: revenue } }, create: { type: 'Revenue', balance: revenue } })

      let cardLinked = false
      if (r.nfcCard) {
        const card = await tx.memberCard.updateMany({
          where: { serial: r.nfcCard, status: 'Unlinked', expiryDate: { gt: now } },
          data: { customerId: customer.id, agentId: r.agentId, status: 'Linked', linkedAt: now },
        })
        cardLinked = card.count === 1
      }

      // notify: none — the same approval as above; this only files the CST number and drops the copies the customer now holds
      await tx.customerRequest.update({ where: { id: r.id }, data: { customerCode, photoUrl: null, bvn: null } })
      await notify(tx, notifications.customerRequestApproved({ id: r.id, agentId: r.agentId, customerName, customerCode }))
      await tx.auditLog.createMany({
        data: [
          { action: 'customer_request_approved', entity: 'CustomerRequest', entityId: r.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name,
            details: `Approved ${customerName} (${customerCode}) from ${r.agent.name}; ${formatNaira(fee, { minor: false })} taken from the agent’s wallet${r.nfcCard ? `; card ${cardLinked ? 'linked' : 'could not be linked'}` : ''}` },
          { action: 'enrolment', entity: 'Customer', entityId: customer.id, actorType: 'agent', actorId: r.agentId, actorName: r.agent.name,
            details: `Customer enrolled — ${customerName} (${customerCode})` },
        ],
      })
      return { customerCode, cardLinked }
    }, { maxWait: 10_000, timeout: 20_000 })
    return { ok: true, ...out, hadCard: !!r.nfcCard, customerName, fee, agent: { email: r.agent.email, name: r.agent.name }, customer: { firstName: r.firstName, phone: r.phone } }
  } catch (e) {
    if (e instanceof Stop) {
      if (e.noFunds) await notify(client, notifications.customerRequestNeedsFunds({ id: r.id, agentId: r.agentId, customerName, fee, dayKey: isoDate(now) })).catch(() => {})
      return { ok: false, status: e.status, error: e.message }
    }
    throw e
  }
}

export type DeniedInfo = { customerName: string; agent: { email: string | null } }

/** Denial: frees the phone and email and sends the request back to the agent with what to fix. No money moves. */
export async function denyCustomerRequest(client: PrismaClient, input: { id: string; admin: Admin; reason: string; fix: string }, now: Date = new Date()): Promise<DecisionResult<DeniedInfo>> {
  const r = await client.customerRequest.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, agentId: true, firstName: true, lastName: true, agent: { select: { email: true } } },
  })
  if (!r) return { ok: false, status: 404, error: 'Request not found.' }
  const customerName = fullName(r)
  const done = await client.$transaction(async tx => {
    // notify: customerRequestDenied
    const claimed = await tx.customerRequest.updateMany({
      where: { id: r.id, status: 'Pending' },
      data: { status: 'Denied', decidedAt: now, decidedBy: input.admin.name, decidedById: input.admin.id ?? null, denyReason: input.reason, denyFix: input.fix, pendingPhone: null, pendingEmail: null },
    })
    if (claimed.count !== 1) return false
    await notify(tx, notifications.customerRequestDenied({ id: r.id, agentId: r.agentId, customerName, decidedAt: now }))
    await tx.auditLog.create({ data: { action: 'customer_request_denied', entity: 'CustomerRequest', entityId: r.id, actorType: input.admin.type, actorId: input.admin.id, actorName: input.admin.name, details: `Denied ${customerName}. Reason: ${input.reason}. To work on: ${input.fix}` } })
    return true
  })
  if (!done) return { ok: false, status: 409, error: 'This request has already been decided.' }
  return { ok: true, customerName, agent: { email: r.agent.email } }
}

/**
 * The agent drops one of their own requests: still waiting, or denied and not worth fixing. Kept as 'Cancelled' for
 * history; it leaves the agent's list and the office's queue, and frees the phone and email. Nothing was charged yet
 * (the fee is taken only at approval), so no money moves.
 */
export async function cancelCustomerRequest(client: PrismaClient, input: { agent: { id: string; name: string }; id: string }): Promise<DecisionResult> {
  const r = await client.customerRequest.findFirst({
    where: { id: input.id, agentId: input.agent.id },
    select: { id: true, status: true, firstName: true, lastName: true },
  })
  if (!r) return { ok: false, status: 404, error: 'Request not found.' }
  const done = await client.$transaction(async tx => {
    // notify: none — the agent cancels it themselves on the screen that confirms it
    const claimed = await tx.customerRequest.updateMany({
      where: { id: r.id, agentId: input.agent.id, status: { in: ['Pending', 'Denied'] } },
      data: { status: 'Cancelled', pendingPhone: null, pendingEmail: null },
    })
    if (claimed.count !== 1) return false
    await tx.auditLog.create({ data: { action: 'customer_request_cancelled', entity: 'CustomerRequest', entityId: r.id, actorType: 'agent', actorId: input.agent.id, actorName: input.agent.name, details: `Cancelled the request for ${fullName(r)} (was ${r.status === 'Pending' ? 'waiting for approval' : 'denied'})` } })
    return true
  })
  if (!done) return { ok: false, status: 409, error: 'This request can’t be cancelled now. It may already have been decided.' }
  return { ok: true }
}
