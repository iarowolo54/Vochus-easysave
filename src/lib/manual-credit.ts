// Crediting a bank transfer by hand. Staff do this when a payment arrived but the alert never matched, or a customer
// or agent paid and no alert came. It reuses the automatic settle paths, so fees, covered days and the transaction
// record are exactly what an automatic credit would give. Every step is a conditional update, so two staff acting on
// the same row credit it once.
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING } from '@/lib/payment-intent'
import { settleIntentPayment } from '@/lib/customer-settle'
import { settleAgentTransfer } from '@/lib/agent-settle'
import { TRANSFER_METHOD, TRANSFER_WINDOW_MS } from '@/lib/transfer-intent'
import { money } from '@/lib/wallet-guard'

export type Admin = { id?: string; name: string }
export type ManualResult = { ok: true; amount: number } | { ok: false; status: 404 | 409 | 422; error: string }

export const NOTE_MIN = 3
export const NOTE_MAX = 300

export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const note = raw.trim()
  return note.length >= NOTE_MIN && note.length <= NOTE_MAX ? note : null
}

const CLOSED = 'This can’t be credited as it stands: the plan is closed or the account is missing. Nothing was credited.'
const TAKEN = 'This was already dealt with by someone else.'

function audit(admin: Admin, action: string, entityId: string, details: string) {
  return logAudit({ action, entity: 'Transfer', entityId, details, actorType: 'admin', actorId: admin.id, actorName: admin.name })
}

async function settle(client: PrismaClient, intent: Awaited<ReturnType<PrismaClient['paymentIntent']['findUniqueOrThrow']>>, note: string) {
  if (intent.actorType === 'agent') {
    return settleAgentTransfer(client, {
      intent, reference: intent.ref, amountNaira: intent.amount, via: 'Staff by hand', note: `Bank transfer credited by hand by staff — ${note}`,
    })
  }
  return settleIntentPayment(client, {
    intent, reference: intent.ref, amountNaira: intent.amount, currency: intent.currency, channel: 'bank_transfer', via: 'Staff by hand',
  })
}

/** A started transfer the person says they paid. Credited at the amount they were shown. */
export async function creditRequestByHand(client: PrismaClient, input: { ref: string; admin: Admin; note: string }): Promise<ManualResult> {
  const intent = await client.paymentIntent.findFirst({ where: { ref: input.ref, method: TRANSFER_METHOD } })
  if (!intent) return { ok: false, status: 404, error: 'Transfer not found.' }
  if (intent.status !== INTENT_PENDING) return { ok: false, status: 409, error: TAKEN }

  const result = await settle(client, intent, input.note)
  if (result.kind === 'already') return { ok: false, status: 409, error: TAKEN }
  if (result.kind === 'review') return { ok: false, status: 422, error: CLOSED }

  await client.paymentIntent.update({ where: { id: intent.id }, data: { manualBy: input.admin.name, manualNote: input.note } })
  await audit(input.admin, 'bank_transfer_credited_by_hand', intent.ref,
    `${input.admin.name} credited ₦${intent.amount} by hand (${intent.actorType}) — ref ${intent.ref} — note: ${input.note}`)
  return { ok: true, amount: intent.amount }
}

export type AlertTarget = { kind: 'customer'; customerId: string; planId: string } | { kind: 'agent'; agentId: string }

/** Money that arrived and was held. Credited to the customer's plan or the agent's wallet staff choose. */
export async function creditAlertByHand(
  client: PrismaClient,
  input: { alertId: string; target: AlertTarget; admin: Admin; note: string },
): Promise<ManualResult> {
  const alert = await client.bankAlert.findUnique({ where: { id: input.alertId } })
  if (!alert) return { ok: false, status: 404, error: 'Held payment not found.' }

  // The target must exist, and a plan must belong to the customer, before anything is claimed.
  if (input.target.kind === 'customer') {
    const plan = await client.savingsPlan.findFirst({ where: { id: input.target.planId, customerId: input.target.customerId }, select: { id: true } })
    if (!plan) return { ok: false, status: 404, error: 'That customer or plan wasn’t found.' }
  } else {
    const agent = await client.agent.findUnique({ where: { id: input.target.agentId }, select: { id: true } })
    if (!agent) return { ok: false, status: 404, error: 'That agent wasn’t found.' }
  }

  // Claim it first. Only one caller can flip Unmatched to Resolved.
  const claimed = await client.bankAlert.updateMany({
    where: { id: alert.id, status: 'Unmatched' },
    data: { status: 'Resolved', resolvedAt: new Date(), resolvedBy: input.admin.name, resolvedNote: input.note },
  })
  if (claimed.count !== 1) return { ok: false, status: 409, error: TAKEN }

  const amount = money(alert.amount)
  const ref = `VCHS-MAN-${Date.now()}-${randomBytes(5).toString('base64url').toUpperCase()}`
  const intent = await client.paymentIntent.create({
    data: {
      ref, method: TRANSFER_METHOD, amount, expiresAt: new Date(Date.now() + TRANSFER_WINDOW_MS),
      manualBy: input.admin.name, manualNote: input.note,
      ...(input.target.kind === 'customer'
        ? { actorType: 'customer', customerId: input.target.customerId, planId: input.target.planId }
        : { actorType: 'agent', agentId: input.target.agentId }),
    },
  })

  const undo = async () => {
    await client.paymentIntent.deleteMany({ where: { id: intent.id, status: { not: 'Done' } } })
    await client.bankAlert.updateMany({
      where: { id: alert.id, status: 'Resolved' },
      data: { status: 'Unmatched', resolvedAt: null, resolvedBy: null, resolvedNote: null },
    })
  }

  try {
    const result = await settle(client, intent, input.note)
    if (result.kind !== 'credited') {
      await undo()
      return { ok: false, status: 422, error: CLOSED }
    }
  } catch (e) {
    await undo()
    throw e
  }

  await client.bankAlert.update({ where: { id: alert.id }, data: { intentRef: ref } })
  await audit(input.admin, 'bank_transfer_credited_by_hand', ref,
    `${input.admin.name} credited a held ₦${amount} (bank txn ${alert.txnId}) to ${input.target.kind} ${input.target.kind === 'customer' ? input.target.customerId : input.target.agentId} — note: ${input.note}`)
  return { ok: true, amount }
}

/** Not a customer or agent payment, or already credited by hand. Takes it off the review list without crediting. */
export async function dismissAlert(client: PrismaClient, input: { alertId: string; admin: Admin; note: string }): Promise<ManualResult> {
  const alert = await client.bankAlert.findUnique({ where: { id: input.alertId } })
  if (!alert) return { ok: false, status: 404, error: 'Held payment not found.' }
  const res = await client.bankAlert.updateMany({
    where: { id: alert.id, status: 'Unmatched' },
    data: { status: 'Dismissed', resolvedAt: new Date(), resolvedBy: input.admin.name, resolvedNote: input.note },
  })
  if (res.count !== 1) return { ok: false, status: 409, error: TAKEN }
  await audit(input.admin, 'bank_alert_dismissed', alert.id,
    `${input.admin.name} dismissed a held ₦${alert.amount} (bank txn ${alert.txnId}) — note: ${input.note}`)
  return { ok: true, amount: alert.amount }
}
