import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFlexibleSettings } from '@/lib/flexible-savings'

// The terms a person is shown while choosing a flexible plan. Public on purpose: online customers read them on the
// sign-up screen before they have an account, and they are the same terms printed on the screen. Agent shares are left out.
export async function GET() {
  const s = await getFlexibleSettings(prisma)
  return NextResponse.json(
    { minTermMonths: s.minTermMonths, minDeposit: s.minDeposit, cashCommissionPct: s.cashCommissionPct, penaltyPct: s.penaltyPct },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
