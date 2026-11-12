// Customer photos taken by agents wait for the super admin (docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md).
// Only an approved photo reaches Customer.photoUrl; until then the old photo (or none) stays. One waiting photo per
// customer, enforced by the unique pendingCustomerId. Online customers' own photos don't come through here.
import type { PrismaClient } from '@prisma/client'
import { validatePhoto } from '@/lib/photo'
import { notifications, notify } from '@/lib/notifications'

type Fail = { ok: false; status: 400 | 404 | 409; error: string }
type Admin = { id?: string; name: string; type: string }

const DECIDED = 'This photo has already been checked.'

export async function submitAgentPhoto(
  client: PrismaClient,
  i: { customerDbId: string; agent: { id: string; name: string; agentId: string }; photoUrl: unknown },
): Promise<{ ok: true; requestId: string } | Fail> {
  if (typeof i.photoUrl !== 'string' || !i.photoUrl) return { ok: false, status: 400, error: 'Take a photo of the customer’s face.' }
  const check = validatePhoto(i.photoUrl)
  if (!check.ok) return { ok: false, status: 400, error: check.error }
  const photoUrl = i.photoUrl

  // Own-the-data: only the customer's own agent.
  const customer = await client.customer.findFirst({ where: { id: i.customerDbId, agentId: i.agent.id }, select: { id: true, firstName: true, lastName: true, customerId: true, photoUrl: true } })
  if (!customer) return { ok: false, status: 404, error: 'Customer not found' }

  const now = new Date()
  const requestId = await client.$transaction(async tx => {
    // notify: none — submitting only queues the photo for the super admin; the agent is told when it's decided
    const waiting = await tx.customerPhotoRequest.updateMany({
      where: { pendingCustomerId: customer.id, status: 'Pending' },
      data: { photoUrl, submittedAt: now, agentId: i.agent.id },
    })
    const id = waiting.count === 1
      ? (await tx.customerPhotoRequest.findUniqueOrThrow({ where: { pendingCustomerId: customer.id }, select: { id: true } })).id
      : (await tx.customerPhotoRequest.create({ data: { customerId: customer.id, agentId: i.agent.id, photoUrl, pendingCustomerId: customer.id }, select: { id: true } })).id
    await tx.auditLog.create({
      data: {
        action: 'customer_photo_submitted', entity: 'CustomerPhotoRequest', entityId: id, actorType: 'agent', actorId: i.agent.id, actorName: i.agent.name,
        details: `Agent ${i.agent.name} (${i.agent.agentId}) sent a photo of ${customer.firstName} ${customer.lastName} (${customer.customerId}) for checking${customer.photoUrl ? ', to replace their current one' : ''}`,
      },
    })
    return id
  })
  return { ok: true, requestId }
}

async function load(client: PrismaClient, id: string) {
  return client.customerPhotoRequest.findUnique({
    where: { id },
    select: { id: true, status: true, agentId: true, customerId: true, photoUrl: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
  })
}

export async function approvePhotoRequest(client: PrismaClient, i: { id: string; admin: Admin }): Promise<{ ok: true } | Fail> {
  const r = await load(client, i.id)
  if (!r) return { ok: false, status: 404, error: 'Photo not found.' }
  if (r.status !== 'Pending' || !r.photoUrl) return { ok: false, status: 409, error: DECIDED }
  const photoUrl = r.photoUrl
  const customerName = `${r.customer.firstName} ${r.customer.lastName}`
  const now = new Date()
  const done = await client.$transaction(async tx => {
    // notify: customerPhotoApproved
    const claimed = await tx.customerPhotoRequest.updateMany({
      where: { id: r.id, status: 'Pending' },
      data: { status: 'Approved', decidedAt: now, decidedBy: i.admin.name, decidedById: i.admin.id ?? null, pendingCustomerId: null, photoUrl: null, rejectReason: null },
    })
    if (claimed.count !== 1) return false
    await tx.customer.update({ where: { id: r.customerId }, data: { photoUrl } })
    await notify(tx, notifications.customerPhotoApproved({ id: r.id, agentId: r.agentId, customerName }))
    await tx.auditLog.create({
      data: { action: 'customer_photo_approved', entity: 'CustomerPhotoRequest', entityId: r.id, actorType: i.admin.type, actorId: i.admin.id, actorName: i.admin.name, details: `Approved the photo of ${customerName} (${r.customer.customerId})` },
    })
    return true
  })
  return done ? { ok: true } : { ok: false, status: 409, error: DECIDED }
}

export async function rejectPhotoRequest(client: PrismaClient, i: { id: string; admin: Admin; reason: string }): Promise<{ ok: true } | Fail> {
  const reason = i.reason.trim()
  if (reason.length < 3 || reason.length > 300) return { ok: false, status: 400, error: 'Say what’s wrong with the photo (3 to 300 characters).' }
  const r = await load(client, i.id)
  if (!r) return { ok: false, status: 404, error: 'Photo not found.' }
  if (r.status !== 'Pending') return { ok: false, status: 409, error: DECIDED }
  const customerName = `${r.customer.firstName} ${r.customer.lastName}`
  const now = new Date()
  const done = await client.$transaction(async tx => {
    // notify: customerPhotoRejected
    const claimed = await tx.customerPhotoRequest.updateMany({
      where: { id: r.id, status: 'Pending' },
      data: { status: 'Rejected', decidedAt: now, decidedBy: i.admin.name, decidedById: i.admin.id ?? null, pendingCustomerId: null, photoUrl: null, rejectReason: reason },
    })
    if (claimed.count !== 1) return false
    await notify(tx, notifications.customerPhotoRejected({ id: r.id, agentId: r.agentId, customerName, decidedAt: now }))
    await tx.auditLog.create({
      data: { action: 'customer_photo_rejected', entity: 'CustomerPhotoRequest', entityId: r.id, actorType: i.admin.type, actorId: i.admin.id, actorName: i.admin.name, details: `Rejected the photo of ${customerName} (${r.customer.customerId}): ${reason}` },
    })
    return true
  })
  return done ? { ok: true } : { ok: false, status: 409, error: DECIDED }
}

/** The newest photo request per customer (status and reject reason only, never the photo), for list screens. */
export async function latestPhotoRequests(client: PrismaClient, customerIds: string[]): Promise<Map<string, { status: string; rejectReason: string | null }>> {
  const out = new Map<string, { status: string; rejectReason: string | null }>()
  if (!customerIds.length) return out
  const rows = await client.customerPhotoRequest.findMany({
    where: { customerId: { in: customerIds } }, orderBy: { submittedAt: 'desc' }, select: { customerId: true, status: true, rejectReason: true },
  })
  for (const r of rows) if (!out.has(r.customerId)) out.set(r.customerId, { status: r.status, rejectReason: r.rejectReason })
  return out
}
