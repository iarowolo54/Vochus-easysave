import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { REVIEW_ACTION } from '@/lib/payment-intent'
import { PlanClosedError, creditPlanBalance } from '@/lib/plan-credit'
import { depositFeeOps } from '@/lib/commission-ledger'

export type AutoDebitCreditResult = 'credited' | 'already' | 'not_found' | 'review'

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
}

/** The card has been charged, but this can't be credited as it stands. Staff resolve it from the audit log. */
export async function flagAttemptForReview(client: PrismaClient, attemptId: string, reason: string): Promise<void> {
  await client.$transaction(async (tx) => {
    const flipped = await tx.autoDebitAttempt.updateMany({ where: { id: attemptId, status: { notIn: ['success', 'review'] } }, data: { status: 'review' } })
    if (flipped.count === 1) {
      await tx.auditLog.create({
        data: { action: REVIEW_ACTION, entity: 'AutoDebitAttempt', entityId: attemptId, details: `Not credited, needs manual review: ${reason}`, actorType: 'system', actorName: 'Auto-debit' },
      })
    }
  })
}

/**
 * Credit a confirmed auto-debit charge to the savings plan exactly once.
 * Shared by the Paystack webhook and the reconciliation sweep. Idempotent:
 * the unique Transaction.ref makes a replayed/concurrent loser return 'already'.
 */
export async function creditAutoDebitAttempt(
  client: PrismaClient,
  input: { reference: string; settledAmountNaira: number },
): Promise<AutoDebitCreditResult> {
  const { reference, settledAmountNaira } = input

  const attempt = await client.autoDebitAttempt.findUnique({ where: { reference } })
  if (!attempt) return 'not_found'
  if (attempt.status === 'success') return 'already'
  if (attempt.status === 'review') return 'review'

  const plan = await client.savingsPlan.findUnique({ where: { id: attempt.savingsPlanId } })
  if (!plan) return 'not_found'
  const customer = await client.customer.findUnique({ where: { id: plan.customerId } })
  if (!customer) return 'not_found'

  const amount = money(attempt.creditAmount)

  try {
    await client.$transaction(async (tx) => {
      // Claim the attempt first: only one caller can flip it to success.
      const claimed = await tx.autoDebitAttempt.updateMany({
        where: { id: attempt.id, status: { not: 'success' } },
        data: { status: 'success', settledAmount: money(settledAmountNaira) },
      })
      if (claimed.count === 0) throw new Error('ALREADY_PROCESSED')
      const fee = await depositFeeOps(tx, { planId: plan.id, agentId: customer.agentId, customerId: customer.id, amount, ref: reference, at: new Date() })
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: customer.agentId,
          customerId: customer.id,
          planId: plan.id,
          type: 'saving',
          amount,
          method: 'Paystack',
          status: 'Done',
          feeTaken: fee,
          note: 'Auto-debit via Paystack',
        },
      })
      await creditPlanBalance(tx, plan.id, money(amount - fee))
      await tx.autoDebitMandate.update({ where: { id: attempt.mandateId }, data: { consecutiveFailures: 0 } })
    })
  } catch (e: unknown) {
    if ((e instanceof Error && e.message === 'ALREADY_PROCESSED') || isUniqueViolation(e)) return 'already'
    if (e instanceof PlanClosedError) {
      await flagAttemptForReview(client, attempt.id, `charged ₦${money(settledAmountNaira)} but plan ${plan.id} is closed — ref ${reference}`)
      return 'review'
    }
    throw e
  }

  // Best-effort: the credit is already committed, so a logging failure must never throw.
  try {
    await logAudit({
      action: 'customer_auto_debit',
      entity: 'Transaction',
      entityId: attempt.id,
      details: `Auto-debit credited ₦${amount.toLocaleString()} to plan ${plan.id} for ${customer.firstName} ${customer.lastName} (${customer.customerId}) — ref ${reference}`,
      actorType: 'system',
      actorName: 'Auto-debit',
    })
  } catch {
    // ignore
  }
  return 'credited'
}
