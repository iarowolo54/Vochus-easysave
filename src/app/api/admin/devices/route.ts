import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('devices', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim().toLowerCase()

  const rows = await prisma.deviceSession.findMany({
    orderBy: { lastSeenAt: 'desc' },
    take: 500,
  })

  // Hydrate actor info
  const agentIds = Array.from(new Set(rows.map(r => r.agentId).filter(Boolean) as string[]))
  const customerIds = Array.from(new Set(rows.map(r => r.customerId).filter(Boolean) as string[]))
  const [agents, customers] = await Promise.all([
    agentIds.length ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, agentId: true, name: true, phone: true } }) : [],
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, customerId: true, firstName: true, lastName: true, phone: true } }) : [],
  ])
  const agentMap = new Map(agents.map(a => [a.id, a]))
  const customerMap = new Map(customers.map(c => [c.id, c]))

  const items = rows.map(r => {
    const a = r.agentId ? agentMap.get(r.agentId) : null
    const c = r.customerId ? customerMap.get(r.customerId) : null
    return {
      id: r.id,
      deviceId: r.deviceId,
      app: r.app,
      platform: r.platform,
      model: r.model,
      manufacturer: r.manufacturer,
      osVersion: r.osVersion,
      appVersion: r.appVersion,
      ipAddress: r.ipAddress,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      loginCount: r.loginCount,
      actor: a
        ? { kind: 'agent', id: a.id, ref: a.agentId, name: a.name, phone: a.phone }
        : c
          ? { kind: 'customer', id: c.id, ref: c.customerId, name: `${c.firstName} ${c.lastName}`, phone: c.phone }
          : null,
    }
  })

  const filtered = search
    ? items.filter(i =>
        i.deviceId.toLowerCase().includes(search) ||
        (i.model ?? '').toLowerCase().includes(search) ||
        (i.manufacturer ?? '').toLowerCase().includes(search) ||
        (i.actor?.name ?? '').toLowerCase().includes(search) ||
        (i.actor?.ref ?? '').toLowerCase().includes(search) ||
        (i.actor?.phone ?? '').toLowerCase().includes(search))
    : items

  return NextResponse.json({ devices: filtered })
}
