// Regression guard for the Customer -> Agent and Customer -> Staff/SuperAdmin
// directions of findIdentityConflict, which the agent/staff creation routes rely on.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { findIdentityConflict } from '../src/lib/identity'

const rid = Math.random().toString(36).slice(2, 10)
const digits = String(Math.floor(1000000 + Math.random() * 9000000))
const custPhone = '0706' + digits
const custEmail = `wiring_${rid}@example.com`
let ownerAgentId = ''
let custId = ''

before(async () => {
  // Customer needs an owning agent; its own phone is distinct from the one under test.
  const a = await prisma.agent.create({ data: { agentId: `WR-${rid}`, phone: '0707' + digits, name: 'A', location: 'x', password: 'x' } })
  ownerAgentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `WRC-${rid}`, agentId: ownerAgentId, firstName: 'A', lastName: 'B',
      phone: custPhone, email: custEmail, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  custId = c.id
})

after(async () => {
  await prisma.customer.deleteMany({ where: { id: custId } })
  await prisma.agent.deleteMany({ where: { id: ownerAgentId } })
  await prisma.$disconnect()
})

test('a Customer phone blocks a new Agent', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: custPhone }), 'phone')
})

test('a Customer email collides on the Staff/SuperAdmin email direction', async () => {
  assert.equal(await findIdentityConflict(prisma, { email: custEmail }), 'email')
})
