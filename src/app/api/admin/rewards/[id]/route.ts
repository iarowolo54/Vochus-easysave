import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, isNotFound } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { name, startDate, endDate, offlineRewardAmount, onlineRewardAmount, isActive } = body as {
    name?: string; startDate?: string; endDate?: string
    offlineRewardAmount?: number | string; onlineRewardAmount?: number | string; isActive?: boolean
  }

  const parseDate = (v: unknown): Date | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const parseAmount = (v: unknown): number | null => {
    if (typeof v === 'string' && v.trim() === '') return null
    if (typeof v !== 'string' && typeof v !== 'number') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const start = startDate !== undefined ? parseDate(startDate) : undefined
  const end = endDate !== undefined ? parseDate(endDate) : undefined
  const offline = offlineRewardAmount !== undefined ? parseAmount(offlineRewardAmount) : undefined
  const online = onlineRewardAmount !== undefined ? parseAmount(onlineRewardAmount) : undefined
  if (start === null) return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
  if (end === null) return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 })
  if (offline === null) return NextResponse.json({ error: 'offlineRewardAmount must be a non-negative number' }, { status: 400 })
  if (online === null) return NextResponse.json({ error: 'onlineRewardAmount must be a non-negative number' }, { status: 400 })
  if (name !== undefined && typeof name !== 'string') return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  if (isActive !== undefined && typeof isActive !== 'boolean') return NextResponse.json({ error: 'Invalid isActive' }, { status: 400 })

  const promo = await prisma.rewardPromo.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(start !== undefined && { startDate: start }),
      ...(end !== undefined && { endDate: end }),
      ...(offline !== undefined && { offlineRewardAmount: offline }),
      ...(online !== undefined && { onlineRewardAmount: online }),
      ...(isActive !== undefined && { isActive }),
    },
  }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!promo) return NextResponse.json({ error: 'Promo not found' }, { status: 404 })

  await logAudit({
    action: 'reward_promo_update',
    entity: 'RewardPromo',
    entityId: promo.id,
    details: `Reward promo "${promo.name}" updated (${Object.keys(body as object).join(', ')})`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ promo })
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const deleted = await prisma.rewardPromo.delete({ where: { id } }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!deleted) return NextResponse.json({ error: 'Promo not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
