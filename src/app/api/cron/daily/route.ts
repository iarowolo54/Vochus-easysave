import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { accruedInterestForPlan } from '@/lib/savings-interest-plan'
import { reconcileAbandonedEnrollments, runDueAutoDebits, reconcileProcessingAttempts } from '@/lib/auto-debit-run'
import { sendWeeklySummaries } from '@/lib/weekly-summary-run'
import { isSummaryDay } from '@/lib/summary-day'

export const dynamic = 'force-dynamic'

/** Constant-time bearer check. Fails closed when CRON_SECRET is unset/empty. */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  if (!match) return false
  const given = Buffer.from(match[1])
  const expected = Buffer.from(secret)
  // timingSafeEqual throws on unequal lengths; a length mismatch is simply a rejection.
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let accrued = 0
  let failed = 0

  // Pass 1: persist accrued interest for active online plans.
  const plans = await prisma.savingsPlan.findMany({
    where: { status: 'Active', source: 'self' },
    select: { id: true, source: true, startDate: true, maturityDate: true },
  })
  for (const plan of plans) {
    try {
      const interestAccrued = await accruedInterestForPlan(prisma, plan, now)
      await prisma.savingsPlan.update({ where: { id: plan.id }, data: { interestAccrued } })
      accrued++
    } catch (err) {
      // One failing plan must not halt the batch; log id + message only (never secrets/payloads).
      failed++
      console.error('[cron/daily] accrual failed', plan.id, err instanceof Error ? err.message : 'unknown')
    }
  }

  // Pass 2: fire due auto-debits. Pass 3: settle/fail stuck 'processing' charges.
  let charged = 0
  let skipped = 0
  let debitFailed = 0
  let pending = 0
  let settled = 0
  try {
    const run = await runDueAutoDebits(prisma, now)
    charged = run.charged
    skipped = run.skipped
    debitFailed = run.failed
    pending = run.pending
  } catch (err) {
    console.error('[cron/daily] auto-debit run failed', err instanceof Error ? err.message : 'unknown')
  }
  try {
    const rec = await reconcileProcessingAttempts(prisma, now)
    settled = rec.settled
    await reconcileAbandonedEnrollments(prisma, now)
  } catch (err) {
    console.error('[cron/daily] auto-debit reconcile failed', err instanceof Error ? err.message : 'unknown')
  }

  // Pass 4 (Fridays only): weekly savings summaries by email/SMS.
  let emailed = 0
  let smsed = 0
  let summarySkipped = 0
  let summaryFailed = 0
  if (isSummaryDay(now)) {
    try {
      const s = await sendWeeklySummaries(prisma, now)
      emailed = s.emailed
      smsed = s.smsed
      summarySkipped = s.skipped
      summaryFailed = s.failed
    } catch (err) {
      console.error('[cron/daily] weekly summary failed', err instanceof Error ? err.message : 'unknown')
    }
  }

  return NextResponse.json({ accrued, failed, charged, skipped, debitFailed, pending, settled, emailed, smsed, summarySkipped, summaryFailed })
}
