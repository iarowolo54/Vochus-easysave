import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, isNotFound } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { name, startDate, endDate, offlineRewardAmount, onlineRewardAmount, isActive } = body as {
    name?: string; startDate?: string; endDate?: string
    offlineRewardAmount?: number | string; onlineRewardAmount?: number | string; isActive?: boolean
  }

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
  }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!promo) return NextResponse.json({ error: 'Promo not found' }, { status: 404 })

  return NextResponse.json({ promo })
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const deleted = await prisma.rewardPromo.delete({ where: { id } }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!deleted) return NextResponse.json({ error: 'Promo not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
