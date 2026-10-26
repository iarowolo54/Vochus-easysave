import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth()))
  const customerId = searchParams.get('customerId')

  const monthStart = new Date(year, month, 1)
  const monthEnd   = new Date(year, month + 1, 1)

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, agentId: agent.id },
    })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const plan = await prisma.savingsPlan.findFirst({
      where: { customerId: customer.id, status: 'Active' },
      orderBy: { startDate: 'desc' },
    })

    const transactions = await prisma.transaction.findMany({
      where: {
        agentId: agent.id,
        customerId: customer.id,
        type: 'saving',
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      orderBy: { createdAt: 'asc' },
    })

    const days: Record<number, { amount: number; ref: string; time: string }> = {}
    for (const tx of transactions) {
      const d = tx.createdAt.getDate()
      if (!days[d]) {
        days[d] = {
          amount: 0,
          ref: tx.ref,
          time: tx.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        }
      }
      days[d].amount += tx.amount
    }

    return NextResponse.json({ customer: { ...customer, name: `${customer.firstName} ${customer.lastName}` }, plan, days })
  }

  const customers = await prisma.customer.findMany({
    where: { agentId: agent.id },
    include: {
      savingsPlans: {
        where: { status: 'Active' },
        orderBy: { startDate: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = await Promise.all(customers.map(async (c) => {
    const plan = c.savingsPlans[0]

    const txs = await prisma.transaction.findMany({
      where: {
        agentId: agent.id,
        customerId: c.id,
        type: 'saving',
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      select: { amount: true, createdAt: true },
    })

    const dim = new Date(year, month + 1, 0).getDate()
    const today = new Date()
    const isCurMo = year === today.getFullYear() && month === today.getMonth()
    const maxDay = isCurMo ? today.getDate() : dim

    const byDay: Record<number, number> = {}
    for (const tx of txs) {
      const d = tx.createdAt.getDate()
      byDay[d] = (byDay[d] ?? 0) + tx.amount
    }

    let saved = 0, missed = 0, total = 0, cur = 0, bestStreak = 0
    for (let d = 1; d <= maxDay; d++) {
      const v = byDay[d] ?? 0
      if (v > 0) { saved++; total += v; cur++; bestStreak = Math.max(bestStreak, cur) }
      else { missed++; cur = 0 }
    }
    const pct = (saved + missed) > 0 ? Math.round(saved / (saved + missed) * 100) : 0

    return {
      id: c.id,
      customerId: c.customerId,
      name: `${c.firstName} ${c.lastName}`,
      phone: c.phone,
      plan: plan ? {
        id: plan.id,
        dailyAmount: plan.dailyAmount,
        periodDays: plan.periodDays,
        startDate: plan.startDate,
        maturityDate: plan.maturityDate,
        balance: plan.balance,
      } : null,
      monthStats: { saved, missed, total, pct, bestStreak },
    }
  }))

  return NextResponse.json({ customers: result })
}
