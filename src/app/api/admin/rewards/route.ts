import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [promos, rewards, totals] = await Promise.all([
    prisma.rewardPromo.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.agentReward.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        agent: { select: { name: true, agentId: true } },
        customer: { select: { firstName: true, lastName: true, customerId: true } },
        promo: { select: { name: true } },
      },
    }),
    prisma.agentReward.aggregate({ _sum: { amount: true }, _count: true }),
  ])

  return NextResponse.json({
    promos,
    rewards,
    totalAmount: totals._sum.amount ?? 0,
    totalCount: totals._count,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, startDate, endDate, offlineRewardAmount, onlineRewardAmount } = body

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'Start and end dates required' }, { status: 400 })
  }

  const promo = await prisma.rewardPromo.create({
    data: {
      name: name || 'Registration Reward',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      offlineRewardAmount: Number(offlineRewardAmount ?? 200),
      onlineRewardAmount: Number(onlineRewardAmount ?? 500),
      isActive: true,
    },
  })

  return NextResponse.json({ promo })
}
