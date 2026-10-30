// Weekly savings summary: select active savers, dedupe per ISO week, send email (or SMS fallback).
import type { PrismaClient } from '@prisma/client'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { buildWeeklySummary, isoWeekKey, weekWindow } from '@/lib/weekly-summary'

const KIND = 'weekly_summary'

export interface WeeklySummaryRunResult {
  emailed: number
  smsed: number
  skipped: number
  failed: number
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
}

export async function sendWeeklySummaries(
  client: PrismaClient,
  now: Date,
  opts?: { customerIds?: string[] },
): Promise<WeeklySummaryRunResult> {
  const result: WeeklySummaryRunResult = { emailed: 0, smsed: 0, skipped: 0, failed: 0 }
  const periodKey = isoWeekKey(now)
  const { start, end } = weekWindow(now)

  const customers = await client.customer.findMany({
    where: {
      status: 'Active',
      savingsPlans: { some: { status: 'Active' } },
      ...(opts?.customerIds ? { id: { in: opts.customerIds } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      email: true,
      phone: true,
      savingsPlans: {
        where: { status: 'Active' },
        select: { balance: true, maturityDate: true, interestAccrued: true, status: true },
      },
    },
  })

  for (const c of customers) {
    try {
      const email = c.email?.trim()
      const phone = c.phone?.trim()
      if (!email && !phone) {
        result.skipped++
        continue
      }

      // Insert-first dedupe: the unique constraint makes concurrent/re-fired runs safe.
      try {
        await client.notificationLog.create({ data: { customerId: c.id, kind: KIND, periodKey } })
      } catch (e) {
        if (isUniqueViolation(e)) {
          result.skipped++
          continue
        }
        throw e
      }

      const weekDeposits = await client.transaction.findMany({
        where: { customerId: c.id, type: 'saving', status: 'Done', createdAt: { gte: start, lte: end } },
        select: { amount: true },
      })
      const summary = buildWeeklySummary({
        firstName: c.firstName,
        plans: c.savingsPlans,
        weekDeposits,
        asOf: now,
      })

      if (email) {
        await sendMail({ to: email, subject: 'Your Vochus weekly savings summary', html: summary.emailHtml })
        result.emailed++
      } else if (phone) {
        await sendSMS(phone, summary.smsText)
        result.smsed++
      }
    } catch (e) {
      result.failed++
      console.error(`[weekly-summary] failed for customer ${c.id}: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }
  return result
}
