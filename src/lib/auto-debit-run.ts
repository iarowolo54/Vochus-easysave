import type { PrismaClient } from '@prisma/client'
import { dueMandates } from '@/lib/auto-debit'
import { autoDebitCadence, cycleCreditAmount, nextRunAfter } from '@/lib/auto-debit-schedule'
import { grossUpForFee } from '@/lib/auto-debit-fee'
import { PaystackReferenceNotFound, chargeAuthorization, verifyTransaction } from '@/lib/paystack'
import { creditAutoDebitAttempt, flagAttemptForReview } from '@/lib/auto-debit-credit'
import { recordAutoDebitFailure } from '@/lib/auto-debit-failure'
import { logAudit } from '@/lib/audit'
import { hasOpenRedemption, heldKeys, loadCycleState } from '@/lib/bulk-savings'
import { isCycleCovered, isCycleInPlan, isSlotFunded } from '@/lib/pay-ahead'

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
          data: { nextRunAt: nextRunAfter(mandate.nextRunAt, now, autoDebitCadence(plan.cadence)) },
        })

      const creditAmount = cycleCreditAmount(plan, now)
      if (creditAmount <= 0) {
        await advance()
        skipped++
        continue
      }

      // Nothing is due outside the plan's own days: before a future start, or on the maturity day.
      if (!isCycleInPlan(plan, now) || await hasOpenRedemption(client, plan.id, now)) {
        await advance()
        skipped++
        continue
      }

      // Already paid for, through Bulk Savings or plain deposits: charge nothing for this cycle and move on. Not an
      // attempt, so consecutiveFailures stays as it is.
      const paidFor = async () => {
        const { coveredKeys, plainDeposits } = await loadCycleState(client, plan.id)
        return isCycleCovered(plan, coveredKeys, now) || isSlotFunded(plan, plainDeposits, now)
      }
      if (await paidFor()) {
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

      // The customer is in checkout for this day. Leave nextRunAt alone so the mandate stays due and can't stick; the
      // hold goes stale after PENDING_HOLD_MS. On a daily cron the next run is tomorrow, so if they abandon checkout
      // this one day goes uncharged: nobody is overcharged, and it shows as missed, payable through Bulk Savings.
      if (isCycleCovered(plan, await heldKeys(client, plan.id, now), now)) {
        await logAudit({
          action: 'auto_debit_deferred',
          entity: 'SavingsPlan',
          entityId: plan.id,
          details: `Auto-debit deferred: a checkout is open for this cycle (${yyyymmdd(now)})`,
          actorType: 'system',
          actorName: 'Auto-debit cron',
        })
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

      // A payment may have settled since the first check. Init refuses this day from here on, so this is the last gap.
      if (await paidFor()) {
        await client.autoDebitAttempt.update({ where: { reference }, data: { status: 'skipped' } })
        skipped++
        continue
      }

      const result = await chargeAuthorization({
        authorizationCode: mandate.authorizationCode,
        email: mandate.authEmail,
        amountNaira: grossCharged,
        reference,
        metadata: { customerId: mandate.customerId, planId: plan.id },
      })

      if (result.status === 'success') {
        const credit = await creditAutoDebitAttempt(client, { reference, settledAmountNaira: grossCharged })
        if (credit === 'review') skipped++
        else charged++
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
        // Money that isn't what we charged is for staff, the same as the webhook won't credit it.
        if (result.amountNaira > 0 && (result.currency !== 'NGN' || result.amountNaira < attempt.creditAmount)) {
          await flagAttemptForReview(client, attempt.id, `reconcile found ${result.currency} ${result.amountNaira}, expected ₦${attempt.creditAmount} — ref ${attempt.reference}`)
          continue
        }
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
      // Past the age threshold and Paystack has never heard of it: the charge never got there. Timeouts stay processing.
      if (err instanceof PaystackReferenceNotFound) {
        await recordAutoDebitFailure(client, { reference: attempt.reference, gatewayResponse: 'Charge never reached Paystack' })
        failed++
        continue
      }
      console.error('[auto-debit] reconcile failed', attempt.savingsPlanId, errMsg(err))
    }
  }
  return { settled, failed }
}
