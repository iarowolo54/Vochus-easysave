import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'

export type AutoDebitCreditResult = 'credited' | 'already' | 'not_found'

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
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
          note: 'Auto-debit via Paystack',
        },
      })
      await tx.savingsPlan.update({ where: { id: plan.id }, data: { balance: { increment: amount } } })
      await tx.autoDebitMandate.update({ where: { id: attempt.mandateId }, data: { consecutiveFailures: 0 } })
    })
  } catch (e: unknown) {
    if ((e instanceof Error && e.message === 'ALREADY_PROCESSED') || isUniqueViolation(e)) return 'already'
    throw e
  }

  await logAudit({
    action: 'customer_auto_debit',
    entity: 'Transaction',
    entityId: attempt.id,
    details: `Auto-debit credited ₦${amount.toLocaleString()} to plan ${plan.id} for customer ${customer.customerId} — ref ${reference}`,
    actorType: 'system',
    actorId: customer.id,
    actorName: 'auto-debit',
  })
  return 'credited'
}
