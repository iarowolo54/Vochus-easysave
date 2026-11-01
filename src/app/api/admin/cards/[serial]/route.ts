import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Admin-only fix for a mislinked member card (#16): unlink it, or move (relink)
// it to another customer. Audited. Agents cannot do this.
//   PATCH { action: "unlink" }      -> clears the link
//   PATCH { customerId: "<id>" }    -> relinks to that customer
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const guard = await requirePermission('cards')
  if (!guard.ok) return guard.response

  const { serial } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as string | undefined
  const customerId = body.customerId as string | undefined

  const card = await prisma.memberCard.findUnique({ where: { serial } })
  if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

  const actor = guard.session.user as { id?: string; name?: string | null }
  const actorId = guard.actor.id
  const actorName = guard.actor.name

  if (action === 'unlink') {
    const updated = await prisma.memberCard.update({
      where: { serial },
      // Preserve Blocked: unlinking must never launder a blocked card into a relinkable one.
      data: { customerId: null, agentId: null, status: card.status === 'Blocked' ? 'Blocked' : 'Unlinked', linkedAt: null },
    })
    await logAudit({
      action: 'card_unlink',
      entity: 'MemberCard',
      entityId: updated.id,
      details: `Admin unlinked card ${serial} (was customer ${card.customerId ?? 'none'})`,
      actorType: guard.actor.type,
      actorId,
      actorName,
    })
    return NextResponse.json({ id: updated.id, serial: updated.serial, status: updated.status, customer: null })
  }

  if (typeof customerId === 'string' && customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, firstName: true, lastName: true, customerId: true, agentId: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Only relink can make a card usable, so only relink refuses a blocked/expired card.
    // Unlink must always work so an admin can detach a dead card from a customer.
    if (card.status === 'Blocked') {
      return NextResponse.json({ error: 'Card is blocked and cannot be relinked' }, { status: 400 })
    }
    if (card.expiryDate.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Card has expired and cannot be relinked' }, { status: 400 })
    }

    const existing = await prisma.memberCard.findFirst({ where: { customerId: customer.id }, select: { serial: true } })
    if (existing) {
      return NextResponse.json({ error: `Customer already has a linked card (${existing.serial})` }, { status: 409 })
    }

    const updated = await prisma.memberCard.update({
      where: { serial },
      data: { customerId: customer.id, agentId: customer.agentId, status: 'Linked', linkedAt: new Date() },
    })
    await logAudit({
      action: 'card_relink',
      entity: 'MemberCard',
      entityId: updated.id,
      details: `Admin relinked card ${serial} to ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
      actorType: guard.actor.type,
      actorId,
      actorName,
    })
    return NextResponse.json({
      id: updated.id,
      serial: updated.serial,
      status: updated.status,
      customer: { name: `${customer.firstName} ${customer.lastName}`, customerId: customer.customerId },
    })
  }

  return NextResponse.json({ error: 'Provide action:"unlink" or a customerId to relink' }, { status: 400 })
}
