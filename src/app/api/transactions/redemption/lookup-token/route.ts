import { NextRequest, NextResponse } from 'next/server'
import { confirmRequestWithCode } from '@/lib/redemption-balance'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hashRedemptionToken } from '@/lib/redemption-token'
import { redemptionLookupRateLimiter } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ valid: false, error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ valid: false, error: 'Agent not found' }, { status: 401 })

  // This route resolves a redemption from the 6-digit code alone (no ref), so a
  // wrong guess matches no record and can't be capped per-redemption like
  // verify-token. Bound code-space brute-forcing with a soft per-agent cap.
  const rl = redemptionLookupRateLimiter.check(`redeem-lookup:${agent.id}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { valid: false, error: 'Too many code lookups. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  const { token } = await req.json()
  if (!token) return NextResponse.json({ valid: false, error: 'Token is required' }, { status: 400 })

  const record = await prisma.earlyRedemption.findFirst({
    where: { token: hashRedemptionToken(token) },
    include: {
      savingsPlan: {
        include: { customer: { select: { agentId: true, firstName: true, lastName: true } } },
      },
    },
  })

  // Single non-committal response for both "no such code" and "belongs to another
  // agent's customer", so a guessed code can't be used to probe existence across
  // tenants.
  if (!record || record.savingsPlan.customer.agentId !== agent.id) {
    return NextResponse.json({ valid: false, error: 'No matching pending redemption for your customers' })
  }
  if (record.status === 'Rejected') return NextResponse.json({ valid: false, error: 'REJECTED', planId: record.savingsPlanId, customerName: `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}` })
  if (record.status !== 'Pending') return NextResponse.json({ valid: false, error: `This redemption has already been ${record.status.toLowerCase()}` })
  if (!record.tokenExpiry || record.tokenExpiry < new Date()) return NextResponse.json({ valid: false, error: 'Token has expired' })
  if (!(await confirmRequestWithCode(prisma, record.id))) return NextResponse.json({ valid: false, error: 'This redemption is no longer pending' })

  return NextResponse.json({
    valid: true,
    record: {
      id: record.id,
      ref: record.ref,
      netPayout: record.netPayout,
      customerName: `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`,
      payoutMethod: record.payoutMethod,
      balance: record.balance,
      penalty: record.penalty,
    },
  })
}
