import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const date = searchParams.get('date') ?? ''

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { loan: { ref: { contains: search } } },
      { loan: { customer: { firstName: { contains: search } } } },
      { loan: { customer: { lastName: { contains: search } } } },
      { loan: { agent: { name: { contains: search } } } },
    ]
  }
  if (date) {
    const d = new Date(date)
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    where.createdAt = { gte: d, lt: next }
  }

  const repayments = await prisma.loanRepayment.findMany({
    where,
    include: {
      loan: {
        include: {
          agent: { select: { name: true, agentId: true } },
          customer: { select: { firstName: true, lastName: true, customerId: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const all = await prisma.loanRepayment.findMany({ select: { amount: true, createdAt: true } })
  const todayReps = all.filter(r => r.createdAt >= todayStart)

  return NextResponse.json({
    repayments: repayments.map(r => ({
      id: r.id,
      loanRef: r.loan.ref,
      amount: r.amount,
      method: r.method,
      customerName: `${r.loan.customer.firstName} ${r.loan.customer.lastName}`,
      customerId: r.loan.customer.customerId,
      agentName: r.loan.agent.name,
      agentId: r.loan.agent.agentId,
      createdAt: r.createdAt,
    })),
    totalRepayments: all.length,
    totalAmount: all.reduce((s, r) => s + r.amount, 0),
    todayCount: todayReps.length,
    todayAmount: todayReps.reduce((s, r) => s + r.amount, 0),
  })
}
