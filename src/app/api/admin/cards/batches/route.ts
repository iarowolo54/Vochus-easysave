import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const cards = await prisma.memberCard.findMany({
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { firstName: true, lastName: true, customerId: true } }, agent: { select: { name: true, agentId: true } } },
  })

  const batchMap = new Map<string, { batchId: string; batchName: string; expiryDate: string; createdAt: string; total: number; linked: number; unlinked: number }>()
  for (const c of cards) {
    if (!batchMap.has(c.batchId)) {
      batchMap.set(c.batchId, { batchId: c.batchId, batchName: c.batchName, expiryDate: c.expiryDate.toISOString(), createdAt: c.createdAt.toISOString(), total: 0, linked: 0, unlinked: 0 })
    }
    const b = batchMap.get(c.batchId)!
    b.total++
    if (c.status === 'Linked') b.linked++; else b.unlinked++
  }

  const allCards = cards.map(c => ({
    id: c.id, serial: c.serial, batchName: c.batchName, batchId: c.batchId,
    expiryDate: c.expiryDate.toISOString(), status: c.status,
    linkedAt: c.linkedAt?.toISOString() ?? null,
    customerName: c.customer ? `${c.customer.firstName} ${c.customer.lastName}` : null,
    customerId: c.customer?.customerId ?? null,
    agentName: c.agent?.name ?? null,
    agentId: c.agent?.agentId ?? null,
  }))

  return NextResponse.json({ batches: Array.from(batchMap.values()), cards: allCards })
}
