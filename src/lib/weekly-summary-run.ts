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
        // sendMail has no NODE_ENV self-gate (sendSMS does), so gate here: never email real
        // customers from dev/staging. The attempt is still counted, mirroring the SMS path.
        if (process.env.NODE_ENV === 'production') {
          await sendMail({ to: email, subject: 'Your Vochus weekly savings summary', html: summary.emailHtml })
        }
        result.emailed++
      } else if (phone) {
        // sendSMS reports gateway errors via its return value rather than throwing.
        // sms: weekly alert, only for customers with no email
        const sms = await sendSMS(phone, summary.smsText)
        if (sms.success) {
          result.smsed++
        } else {
          result.failed++
          console.error(`[weekly-summary] sms send failed for customer ${c.id}`)
        }
      }
    } catch (e) {
      result.failed++
      // Never log the raw message: SMTP/gateway errors can embed the recipient's email or phone.
      console.error(`[weekly-summary] failed for customer ${c.id}: ${e instanceof Error ? e.name : 'UnknownError'}`)
    }
  }
  return result
}
