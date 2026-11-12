// Agent-taken customer photos wait for the super admin (docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md).
// Writes to the worktree's throwaway dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { approvePhotoRequest, rejectPhotoRequest, submitAgentPhoto } from '../src/lib/customer-photo-request'

const rid = Math.random().toString(36).slice(2, 8)
const P1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
const P2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAg=='
const admin = { id: 'admin-test', name: 'Test Admin', type: 'superadmin' as const }
let agentA = { id: '', name: 'Agent A', agentId: `PA-${rid}` }
let agentB = { id: '', name: 'Agent B', agentId: `PB-${rid}` }
const customerIds: string[] = []

const seen = async (id: string) => (await prisma.customerPhotoRequest.findUniqueOrThrow({ where: { id } })).submittedAt.toISOString()

async function mkCustomer(n: number, agentDbId: string) {
  const c = await prisma.customer.create({
    data: { customerId: `PHT-${rid}-${n}`, agentId: agentDbId, firstName: 'Ada', lastName: `Obi${n}`, phone: `0803${rid.replace(/\D/g, '1').slice(0, 3)}${String(1000 + n)}`, address: '1 Market Rd', nokName: 'N', nokRelation: 'R', nokPhone: '08000000000' },
  })
  customerIds.push(c.id)
  return c
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: agentA.agentId, phone: `0811${rid.slice(0, 3)}0001`.slice(0, 11), name: agentA.name, location: 'Lagos', password: 'x' } })
  const b = await prisma.agent.create({ data: { agentId: agentB.agentId, phone: `0811${rid.slice(0, 3)}0002`.slice(0, 11), name: agentB.name, location: 'Lagos', password: 'x' } })
  agentA = { ...agentA, id: a.id }
  agentB = { ...agentB, id: b.id }
})

after(async () => {
  await prisma.notification.deleteMany({ where: { recipientId: { in: [agentA.id, agentB.id] } } })
  await prisma.customerPhotoRequest.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: { in: [agentA.id, agentB.id] } } })
})

test('submit twice keeps one waiting request with the newer photo', async () => {
  const c = await mkCustomer(1, agentA.id)
  const r1 = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P1 })
  const r2 = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P2 })
  assert.ok(r1.ok && r2.ok)
  const pending = await prisma.customerPhotoRequest.findMany({ where: { customerId: c.id, status: 'Pending' } })
  assert.equal(pending.length, 1)
  assert.equal(pending[0].photoUrl, P2)
  const fresh = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.equal(fresh.photoUrl, null, 'nothing reaches the customer before approval')
})

test("another agent's customer is 404, and an empty photo is 400", async () => {
  const c = await mkCustomer(2, agentA.id)
  const other = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentB, photoUrl: P1 })
  assert.deepEqual(other.ok ? null : other.status, 404)
  const empty = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: '' })
  assert.deepEqual(empty.ok ? null : empty.status, 400)
})

test('approve moves the photo onto the customer, clears it from the request and tells the agent', async () => {
  const c = await mkCustomer(3, agentA.id)
  const s = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P1 })
  assert.ok(s.ok)
  const r = await approvePhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId) })
  assert.ok(r.ok)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, P1)
  const req = await prisma.customerPhotoRequest.findUniqueOrThrow({ where: { id: s.requestId } })
  assert.equal(req.status, 'Approved')
  assert.equal(req.photoUrl, null)
  assert.equal(req.pendingCustomerId, null)
  assert.equal(await prisma.notification.count({ where: { recipientId: agentA.id, kind: 'customer_photo_approved' } }), 1)
})

test('approve twice: the second is 409; reject after approve is 409', async () => {
  const c = await mkCustomer(4, agentA.id)
  const s = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P1 })
  assert.ok(s.ok)
  assert.ok((await approvePhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId) })).ok)
  const again = await approvePhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId) })
  assert.equal(again.ok ? null : again.status, 409)
  const rej = await rejectPhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId), reason: 'Face is blurred' })
  assert.equal(rej.ok ? null : rej.status, 409)
})

test('reject needs a reason; the customer keeps no photo; the agent can submit again', async () => {
  const c = await mkCustomer(5, agentA.id)
  const s = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P1 })
  assert.ok(s.ok)
  const noReason = await rejectPhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId), reason: ' ' })
  assert.equal(noReason.ok ? null : noReason.status, 400)
  assert.ok((await rejectPhotoRequest(prisma, { id: s.requestId, admin, seenSubmittedAt: await seen(s.requestId), reason: 'Face is blurred' })).ok)
  const req = await prisma.customerPhotoRequest.findUniqueOrThrow({ where: { id: s.requestId } })
  assert.equal(req.status, 'Rejected')
  assert.equal(req.rejectReason, 'Face is blurred')
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, null)
  assert.equal(await prisma.notification.count({ where: { recipientId: agentA.id, kind: 'customer_photo_rejected' } }), 1)
  const again = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P2 })
  assert.ok(again.ok)
})

test('a photo replaced after the admin opened it cannot be approved or rejected unseen (409)', async () => {
  const c = await mkCustomer(6, agentA.id)
  const s1 = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P1 })
  assert.ok(s1.ok)
  const sawAt = await seen(s1.requestId)
  await new Promise(r => setTimeout(r, 5))
  const s2 = await submitAgentPhoto(prisma, { customerDbId: c.id, agent: agentA, photoUrl: P2 })
  assert.ok(s2.ok)
  const stale = await approvePhotoRequest(prisma, { id: s1.requestId, admin, seenSubmittedAt: sawAt })
  assert.equal(stale.ok ? null : stale.status, 409)
  const staleReject = await rejectPhotoRequest(prisma, { id: s1.requestId, admin, seenSubmittedAt: sawAt, reason: 'Face is blurred' })
  assert.equal(staleReject.ok ? null : staleReject.status, 409)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, null)
  assert.ok((await approvePhotoRequest(prisma, { id: s2.requestId, admin, seenSubmittedAt: await seen(s2.requestId) })).ok)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, P2)
})
