import type { PrismaClient } from '@prisma/client'
import { dueMandates } from '@/lib/auto-debit'
import { autoDebitCadence, cycleCreditAmount, nextRunAt } from '@/lib/auto-debit-schedule'
import { grossUpForFee } from '@/lib/auto-debit-fee'
import { chargeAuthorization, verifyTransaction } from '@/lib/paystack'
import { creditAutoDebitAttempt } from '@/lib/auto-debit-credit'
import { recordAutoDebitFailure } from '@/lib/auto-debit-failure'
import { isCycleCovered } from '@/lib/pay-ahead'

const DEFAULT_RECONCILE_AGE_MS = 2 * 60 * 60 * 1000

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown'
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Fire every due auto-debit. One mandate's failure never halts the batch. */
export async function runDueAutoDebits(
  client: PrismaClient,
  now: Date,
  opts?: { mandateIds?: string[] },
): Promise<{ charged: number; skipped: number; failed: number; pending: number }> {
  let charged = 0
  let pending = 0
  let skipped = 0
  let failed = 0

  const scope = opts?.mandateIds ? new Set(opts.mandateIds) : null
  const due = await dueMandates(client, now)
  const mandates = scope ? due.filter((m) => scope.has(m.id)) : due
  for (const mandate of mandates) {
    const plan = mandate.savingsPlan
    try {
      const advance = () =>
        client.autoDebitMandate.update({
          where: { id: mandate.id },
          data: { nextRunAt: nextRunAt(now, autoDebitCadence(plan.cadence)) },
        })

      const creditAmount = cycleCreditAmount(plan, now)
      if (creditAmount <= 0) {
        await advance()
        skipped++
        continue
      }

      // Already paid for through Bulk Savings: charge nothing for this cycle and move on. Not an attempt,
      // so consecutiveFailures stays as it is.
      const coverage = await client.planDayCoverage.findMany({ where: { savingsPlanId: plan.id }, select: { coversKey: true } })
      if (isCycleCovered(plan, coverage.map(c => c.coversKey), now)) {
        await advance()
        skipped++
        continue
      }

      const { grossCharged, feeEstimate } = grossUpForFee(creditAmount)
      const reference = `autodebit-${plan.id}-${yyyymmdd(now)}`

      const [tx, att] = await Promise.all([
        client.transaction.findUnique({ where: { ref: reference }, select: { id: true } }),
        client.autoDebitAttempt.findUnique({ where: { reference }, select: { id: true } }),
      ])
      if (tx || att) {
        await advance()
        skipped++
        continue
      }

      await client.autoDebitAttempt.create({
        data: {
          mandateId: mandate.id,
          savingsPlanId: plan.id,
          reference,
          cycleDate: now,
          creditAmount,
          grossCharged,
          feeEstimate,
          status: 'processing',
        },
      })
      // Advance before charging so a crash mid-charge cannot re-fire the same cycle.
      await advance()

      const result = await chargeAuthorization({
        authorizationCode: mandate.authorizationCode,
        email: mandate.authEmail,
        amountNaira: grossCharged,
        reference,
        metadata: { customerId: mandate.customerId, planId: plan.id },
      })

      if (result.status === 'success') {
        await creditAutoDebitAttempt(client, { reference, settledAmountNaira: grossCharged })
        charged++
      } else if (result.status === 'failed' || result.status === 'abandoned' || result.status === 'reversed') {
        await recordAutoDebitFailure(client, { reference, gatewayResponse: result.gatewayResponse ?? 'charge failed' })
        failed++
      } else {
        // pending/processing/unknown: leave 'processing'; the reconcile pass settles it later.
        pending++
      }
    } catch (err) {
      failed++
      console.error('[auto-debit] charge failed', plan.id, errMsg(err))
    }
  }
  return { charged, skipped, failed, pending }
}

/** Settle or fail attempts stuck in 'processing' past the threshold. */
export async function reconcileProcessingAttempts(
  client: PrismaClient,
  now: Date,
  olderThanMs: number = DEFAULT_RECONCILE_AGE_MS,
  opts?: { mandateIds?: string[] },
): Promise<{ settled: number; failed: number }> {
  let settled = 0
  let failed = 0

  const stale = await client.autoDebitAttempt.findMany({
    where: {
      status: 'processing',
      createdAt: { lt: new Date(now.getTime() - olderThanMs) },
      ...(opts?.mandateIds ? { mandateId: { in: opts.mandateIds } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const attempt of stale) {
    try {
      const result = await verifyTransaction(attempt.reference)
      if (result.status === 'success') {
        // Test-mode verify reports amount 0: fall back to what we charged.
        const settledAmountNaira = result.amountNaira > 0 ? result.amountNaira : attempt.grossCharged
        const r = await creditAutoDebitAttempt(client, { reference: attempt.reference, settledAmountNaira })
        if (r === 'credited') settled++
      } else if (result.status === 'failed' || result.status === 'abandoned' || result.status === 'reversed') {
        await recordAutoDebitFailure(client, {
          reference: attempt.reference,
          gatewayResponse: result.gatewayResponse ?? 'charge failed',
        })
        failed++
      }
    } catch (err) {
      console.error('[auto-debit] reconcile failed', attempt.savingsPlanId, errMsg(err))
    }
  }
  return { settled, failed }
}
