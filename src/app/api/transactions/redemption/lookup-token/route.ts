import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hashRedemptionToken } from '@/lib/redemption-token'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ valid: false, error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ valid: false, error: 'Agent not found' }, { status: 401 })

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

  if (!record) return NextResponse.json({ valid: false, error: 'Token not found' })
  if (record.savingsPlan.customer.agentId !== agent.id) return NextResponse.json({ valid: false, error: 'Token does not belong to one of your customers' })
  if (record.status === 'Rejected') return NextResponse.json({ valid: false, error: 'REJECTED', planId: record.savingsPlanId, customerName: `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}` })
  if (record.status !== 'Pending') return NextResponse.json({ valid: false, error: `This redemption has already been ${record.status.toLowerCase()}` })
  if (!record.tokenExpiry || record.tokenExpiry < new Date()) return NextResponse.json({ valid: false, error: 'Token has expired' })

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
