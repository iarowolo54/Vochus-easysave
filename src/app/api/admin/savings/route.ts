import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('savings', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''
  const search = searchParams.get('search') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '20')

  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (search) {
    where.OR = [
      { customer: { firstName: { contains: search } } },
      { customer: { lastName: { contains: search } } },
      { customer: { customerId: { contains: search } } },
    ]
  }

  const [plans, total] = await Promise.all([
    prisma.savingsPlan.findMany({
      where,
      include: {
        customer: {
          select: { firstName: true, lastName: true, customerId: true, agent: { select: { name: true, agentId: true } } },
        },
      },
      orderBy: { startDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.savingsPlan.count({ where }),
  ])

  const allActive = await prisma.savingsPlan.findMany({
    where: { status: 'Active' },
    select: { balance: true, maturityDate: true },
  })

  const totalActivePlans = allActive.length
  const totalSavingsPool = allActive.reduce((s, p) => s + p.balance, 0)
  const maturingToday = allActive.filter(p => p.maturityDate <= todayEnd).length
  const maturingThisWeek = allActive.filter(p => p.maturityDate <= weekFromNow).length

  return NextResponse.json({
    plans: plans.map(p => ({
      id: p.id,
      customerName: `${p.customer.firstName} ${p.customer.lastName}`,
      customerId: p.customer.customerId,
      agentName: p.customer.agent.name,
      agentId: p.customer.agent.agentId,
      balance: p.balance,
      dailyAmount: p.dailyAmount,
      periodDays: p.periodDays,
      cadence: p.cadence,
      startDate: p.startDate,
      maturityDate: p.maturityDate,
      status: p.status,
      goal: p.goal,
    })),
    total,
    totalActivePlans,
    totalSavingsPool,
    maturingThisWeek,
    maturingToday,
  })
}
