// Customer → agent: one person, one role. Nothing open may be left on the customer account, and approval converts them
// in one step; the new agent then uploads their own documents. Writes to the local dev.db and removes what it made.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { approveUpgradeRequest, denyUpgradeRequest, findBlockers, resubmitUpgradeRequest, submitUpgradeRequest, type UpgradeFields } from '../src/lib/agent-upgrade'
import { findIdentityConflict } from '../src/lib/identity'

const admin = { id: 'admin-1', name: 'Boss', type: 'superadmin' as const }
const rid = Math.random().toString(36).slice(2, 8)
const digits = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999))
const fields: UpgradeFields = {
  nin: '12345678901', bvn: null, state: 'Lagos', lga: 'Ikeja', address: '12 Allen Avenue', nokName: 'Ada Obi', nokPhone: '08031234567',
}
const agents: string[] = []
const customers: string[] = []
let requester = { id: '', name: 'Agent U' }
let other = { id: '', name: 'Agent V' }

async function onlineCustomer(over: Record<string, unknown> = {}) {
  const c = await prisma.customer.create({
    data: { customerId: `UP-${rid}-${customers.length}`, agentId: requester.id, firstName: 'Tolu', lastName: 'Ade', phone: `081${digits()}`, email: `up-${rid}-${customers.length}@example.test`, emailVerifiedAt: new Date(), address: '1 Road', nokName: 'K', nokRelation: 'Sister', nokPhone: '08000000000', type: 'online', password: '$2a$10$hashhashhashhashhashhu', ...over },
  })
  customers.push(c.id)
  return c
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `UPA-${rid}`, phone: `0752${digits()}`, name: 'Agent U', location: 'Ikeja', password: 'x' } })
  const b = await prisma.agent.create({ data: { agentId: `UPB-${rid}`, phone: `0753${digits()}`, name: 'Agent V', location: 'Ikeja', password: 'x' } })
  agents.push(a.id, b.id)
  requester = { id: a.id, name: a.name }
  other = { id: b.id, name: b.name }
})

after(async () => {
  const made = await prisma.agent.findMany({ where: { fromCustomerId: { in: customers } }, select: { id: true } })
  const allAgents = [...agents, ...made.map(m => m.id)]
  await prisma.notification.deleteMany({ where: { recipientId: { in: [...allAgents, ...customers] } } })
  await prisma.agentUpgradeRequest.deleteMany({ where: { customerId: { in: customers } } })
  await prisma.agentDocument.deleteMany({ where: { agentId: { in: allAgents } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: customers } } })
  await prisma.customer.deleteMany({ where: { id: { in: customers } } })
  await prisma.agent.deleteMany({ where: { id: { in: allAgents } } })
  await prisma.$disconnect()
})

test('an agent can only ask for their own online customer', async () => {
  const c = await onlineCustomer()
  const r = await submitUpgradeRequest(prisma, { agent: other, customerId: c.id, fields })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 404)
  const cash = await onlineCustomer({ type: 'offline' })
  const r2 = await submitUpgradeRequest(prisma, { agent: requester, customerId: cash.id, fields })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.error, /online/)
})

test('money left on the account blocks the request until it is redeemed', async () => {
  const c = await onlineCustomer()
  const plan = await prisma.savingsPlan.create({ data: { customerId: c.id, dailyAmount: 500, periodDays: 30, goal: 'Rent', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86_400_000), balance: 1500 } })
  const r = await submitUpgradeRequest(prisma, { agent: requester, customerId: c.id, fields })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.blockers?.some(b => b.includes('Rent')))
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { balance: 0, status: 'Redeemed' } })
  assert.deepEqual(await findBlockers(prisma, c.id), [])
})

test('one open request per customer, and approval converts them in one step', async () => {
  const c = await onlineCustomer()
  const empty = await prisma.savingsPlan.create({ data: { customerId: c.id, dailyAmount: 500, periodDays: 30, goal: 'New', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86_400_000) } })
  const s = await submitUpgradeRequest(prisma, { agent: requester, customerId: c.id, fields })
  assert.ok(s.ok)
  if (!s.ok) return
  const again = await submitUpgradeRequest(prisma, { agent: requester, customerId: c.id, fields })
  assert.equal(again.ok, false)
  if (!again.ok) assert.equal(again.status, 409)

  const a = await approveUpgradeRequest(prisma, { id: s.id, admin })
  assert.ok(a.ok, !a.ok ? a.error : '')
  if (!a.ok) return
  assert.equal((await approveUpgradeRequest(prisma, { id: s.id, admin })).ok, false) // never twice

  const agent = await prisma.agent.findFirstOrThrow({ where: { fromCustomerId: c.id }, include: { documents: true } })
  assert.equal(agent.agentId, a.newAgentCode)
  assert.equal(agent.phone, c.phone)
  assert.equal(agent.email, c.email)
  assert.equal(agent.password, c.password) // same password
  assert.equal(agent.status, 'Active')
  // No documents on file: they upload their own, and the agent app holds them on the Documents screen until approved.
  assert.equal(agent.documents.length, 0)
  assert.deepEqual(JSON.parse(agent.requiredDocs), ['id', 'addr', 'guar', 'agree'])

  const after = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.equal(after.status, 'Converted')
  assert.equal(after.convertedToAgentId, agent.id)
  assert.equal(after.tokenVersion, c.tokenVersion + 1) // every customer session ended
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: empty.id } })).status, 'Closed') // nothing can be saved into it

  // The phone and email now belong only to the agent: no false clash for them, a real one for anyone else.
  assert.equal(await findIdentityConflict(prisma, { phone: c.phone, email: c.email }, { excludeAgentId: agent.id }), null)
  assert.equal(await findIdentityConflict(prisma, { phone: c.phone }), 'phone')

  const kinds = (await prisma.notification.findMany({ where: { recipientId: { in: [requester.id, agent.id, c.id] }, dedupeKey: { contains: s.id } } })).map(n => n.kind).sort()
  assert.deepEqual(kinds, ['agent_upgrade_approved', 'became_agent'])

  // Already converted: no second request.
  const third = await submitUpgradeRequest(prisma, { agent: requester, customerId: c.id, fields })
  assert.equal(third.ok, false)
})

test('turned down, then fixed and sent straight back to the office', async () => {
  const c = await onlineCustomer()
  const s = await submitUpgradeRequest(prisma, { agent: requester, customerId: c.id, fields })
  assert.ok(s.ok)
  if (!s.ok) return
  assert.ok((await denyUpgradeRequest(prisma, { id: s.id, admin, reason: 'Blurry ID', fix: 'Retake the ID photo' })).ok)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).status, 'Active')
  assert.equal((await resubmitUpgradeRequest(prisma, { agent: other, id: s.id, fields })).ok, false) // not theirs
  assert.ok((await resubmitUpgradeRequest(prisma, { agent: requester, id: s.id, fields })).ok)
  const r = await prisma.agentUpgradeRequest.findUniqueOrThrow({ where: { id: s.id } })
  assert.equal(r.status, 'Pending')
  assert.equal(r.pendingCustomerId, c.id)
})
