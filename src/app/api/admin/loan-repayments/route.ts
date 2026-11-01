import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('loans')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const date = searchParams.get('date') ?? ''

  // The app's day is Africa/Lagos (fixed UTC+1, no DST). Build every day window from it so the
  // date filter and "today" agree regardless of the server's own timezone.
  const lagosDayStart = (ymd: string) => new Date(`${ymd}T00:00:00+01:00`)
  const todayStart = lagosDayStart(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }))

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(lagosDayStart(date).getTime())) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }
    const start = lagosDayStart(date)
    where.createdAt = { gte: start, lt: new Date(start.getTime() + 86_400_000) }
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

  const [total, today] = await Promise.all([
    prisma.loanRepayment.aggregate({ _count: true, _sum: { amount: true } }),
    prisma.loanRepayment.aggregate({ where: { createdAt: { gte: todayStart } }, _count: true, _sum: { amount: true } }),
  ])

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
    totalRepayments: total._count,
    totalAmount: total._sum.amount ?? 0,
    todayCount: today._count,
    todayAmount: today._sum.amount ?? 0,
  })
}
