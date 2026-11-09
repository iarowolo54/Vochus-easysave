import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOnlineRedeemFee } from '@/lib/online-redeem-fee'

// The rates a person is shown while opening an online plan. Public on purpose: online customers read them on the sign-up
// screen before they have an account, and they are the same rates printed on the screen. The agent's share is left out.
export async function GET() {
  const f = await getOnlineRedeemFee(prisma)
  return NextResponse.json({ maturedPct: f.maturedPct, earlyPct: f.earlyPct }, { headers: { 'Cache-Control': 'no-store' } })
}
