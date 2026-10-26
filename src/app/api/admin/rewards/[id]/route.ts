import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

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
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  await prisma.rewardPromo.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
