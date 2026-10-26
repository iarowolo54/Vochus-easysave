import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const records = await prisma.earlyRedemption.findMany({
    where: {
      status: 'TokenValidated',
      savingsPlan: { customer: { agentId: agent.id } },
    },
    include: {
      savingsPlan: {
        include: {
          customer: { select: { firstName: true, lastName: true, customerId: true, phone: true } },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
  })

  return NextResponse.json({
    records: records.map(r => ({
      id: r.id,
      ref: r.ref,
      type: r.type,
      reason: r.reason,
      status: r.status,
      balance: r.balance,
      penalty: r.penalty,
      netPayout: r.netPayout,
      payoutMethod: r.payoutMethod,
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      bankName: r.bankName,
      requestedAt: r.requestedAt,
      customerName: `${r.savingsPlan.customer.firstName} ${r.savingsPlan.customer.lastName}`,
      customerId: r.savingsPlan.customer.customerId,
      customerPhone: r.savingsPlan.customer.phone,
    })),
  })
}
