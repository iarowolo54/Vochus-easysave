import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json()
  const { batchName, quantity, expiryDate, serials, batchId } = body as {
    batchName: string
    quantity: number
    expiryDate: string
    serials: string[]
    batchId: string
  }

  if (!batchName || !quantity || !expiryDate || !serials?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (serials.length !== quantity) {
    return NextResponse.json({ error: 'Serial count mismatch' }, { status: 400 })
  }

  const data = serials.map(serial => ({
    serial,
    batchName,
    batchId,
    expiryDate: new Date(expiryDate),
    status: 'Unlinked',
  }))

  await prisma.memberCard.createMany({ data })

  const cards = await prisma.memberCard.findMany({
    where: { batchId },
    select: { id: true, serial: true },
    orderBy: { createdAt: 'asc' },
  })

  logAudit({
    action: 'card_batch_create',
    entity: 'CardBatch',
    entityId: batchId,
    details: `Generated batch "${batchName}" (${batchId}) — ${cards.length} cards, expiry ${expiryDate}`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ batchId, count: cards.length, cards }, { status: 201 })
}
