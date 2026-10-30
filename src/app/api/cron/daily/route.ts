import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { accruedInterestForPlan } from '@/lib/savings-interest-plan'

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

  // SEAM (Feature 3): Friday summary sending will be added to this same route,
  // after the accrual pass above. Intentionally no summary logic yet.

  return NextResponse.json({ accrued, failed })
}
