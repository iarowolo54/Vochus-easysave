import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const body = await req.json()
  const { name, startDate, endDate, offlineRewardAmount, onlineRewardAmount, isActive } = body

  const promo = await prisma.rewardPromo.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(offlineRewardAmount !== undefined && { offlineRewardAmount: Number(offlineRewardAmount) }),
      ...(onlineRewardAmount !== undefined && { onlineRewardAmount: Number(onlineRewardAmount) }),
      ...(isActive !== undefined && { isActive }),
    },
  })

  return NextResponse.json({ promo })
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  await prisma.rewardPromo.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
