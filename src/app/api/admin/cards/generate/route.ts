import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createCardBatch } from '@/lib/member-card'

const MAX_BATCH = 5000

export async function POST(req: NextRequest) {
  const guard = await requirePermission('cards')
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { batchName, quantity, expiryDate } = body as {
    batchName: string
    quantity: number
    expiryDate: string
  }

  // Serials and the batch id are generated SERVER-SIDE (see member-card.ts) —
  // any client-supplied serials/batchId are ignored so the serial space can't be
  // chosen or made enumerable by the caller.
  const qty = Number(quantity)
  if (!batchName || typeof batchName !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > MAX_BATCH || !expiryDate) {
    return NextResponse.json({ error: 'batchName, a quantity between 1 and 5000, and expiryDate are required' }, { status: 400 })
  }
  const expiry = new Date(expiryDate)
  if (isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Expiry date must be a valid future date' }, { status: 400 })
  }

  const { batchId, cards } = await createCardBatch(prisma, { batchName: batchName.trim(), quantity: qty, expiryDate: expiry })

  logAudit({
    action: 'card_batch_create',
    entity: 'CardBatch',
    entityId: batchId,
    details: `Generated batch "${batchName}" (${batchId}) — ${cards.length} cards, expiry ${expiryDate}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ batchId, count: cards.length, cards }, { status: 201 })
}
