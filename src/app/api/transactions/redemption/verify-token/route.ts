import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redemptionTokenMatches } from '@/lib/redemption-token'

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
  if (!redemptionTokenMatches(record.token, token)) return NextResponse.json({ valid: false, error: 'Invalid token' }, { status: 400 })
  if (!record.tokenExpiry || record.tokenExpiry < new Date()) return NextResponse.json({ valid: false, error: 'Token has expired' }, { status: 400 })

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
