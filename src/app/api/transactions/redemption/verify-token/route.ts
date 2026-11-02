import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redemptionTokenMatches } from '@/lib/redemption-token'
import { reserveRedemptionAttempt } from '@/lib/redemption-attempts'
import { confirmRequestWithCode } from '@/lib/redemption-balance'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ valid: false, error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ valid: false, error: 'Agent not found' }, { status: 401 })

  const { ref, token } = await req.json()
  if (!ref || !token) return NextResponse.json({ valid: false, error: 'Missing fields' }, { status: 400 })

  const record = await prisma.earlyRedemption.findUnique({
    where: { ref },
    include: {
      savingsPlan: {
        include: { customer: { select: { agentId: true, firstName: true, lastName: true } } },
      },
    },
  })

  if (!record) return NextResponse.json({ valid: false, error: 'Redemption record not found' }, { status: 400 })
  if (record.savingsPlan.customer.agentId !== agent.id) return NextResponse.json({ valid: false, error: 'Not authorized for this record' }, { status: 400 })
  if (record.status !== 'Pending') return NextResponse.json({ valid: false, error: 'Record is no longer pending' }, { status: 400 })
  // Expiry first, so an expired code doesn't burn a guess attempt.
  if (!record.tokenExpiry || record.tokenExpiry < new Date()) return NextResponse.json({ valid: false, error: 'Token has expired' }, { status: 400 })

  // Cap wrong guesses: reserve an attempt atomically BEFORE comparing, so a rogue
  // (but authorised) agent can't brute-force the 6-digit code to validate a
  // redemption the customer never confirmed. 0 reserved => locked / over cap.
  if (!(await reserveRedemptionAttempt(prisma, ref))) {
    return NextResponse.json(
      { valid: false, error: 'Too many incorrect attempts. This code is locked — ask the customer to request a new redemption.' },
      { status: 429 },
    )
  }
  if (!redemptionTokenMatches(record.token, token)) return NextResponse.json({ valid: false, error: 'Invalid token' }, { status: 400 })

  // A correct code is the confirmation the admin's approval depends on, so it's recorded here.
  if (!(await confirmRequestWithCode(record, agent))) return NextResponse.json({ valid: false, error: 'Record is no longer pending' }, { status: 400 })

  const customerName = `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`

  return NextResponse.json({
    valid: true,
    record: {
      id: record.id,
      ref: record.ref,
      netPayout: record.netPayout,
      customerName,
      payoutMethod: record.payoutMethod,
    },
  })
}
