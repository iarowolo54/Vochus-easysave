// Integration tests for findIdentityConflict: cross-account phone/email
// uniqueness across Customer, Agent, SubAgent, SuperAdmin and StaffUser.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { findIdentityConflict } from '../src/lib/identity'

const rid = Math.random().toString(36).slice(2, 10)
const digits = String(Math.floor(1000000 + Math.random() * 9000000))
const agentPhone = '0703' + digits // stored 0-prefixed
const custPhone = '0704' + digits
const mixEmail = `Mix_${rid}@Case.com`
const mixEmailLower = mixEmail.toLowerCase()
let agentId = ''
let custId = ''
let nullEmailCustId = ''

function custData(suffix: string, phone: string, email: string | null) {
  return {
    customerId: `ID-${suffix}-${rid}`, agentId, firstName: 'A', lastName: 'B', phone, email,
    address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
  }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ID-${rid}`, phone: agentPhone, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  custId = (await prisma.customer.create({ data: custData('1', custPhone, mixEmail) })).id
  nullEmailCustId = (await prisma.customer.create({ data: custData('2', `0705${digits}`, null) })).id
})

after(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: [custId, nullEmailCustId] } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('phone held by an Agent conflicts for a new customer', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: agentPhone }), 'phone')
})

test('stored raw-cased email matches case-insensitively', async () => {
  assert.equal(await findIdentityConflict(prisma, { email: mixEmailLower }), 'email')
})

test('+234 incoming form matches a stored 0-prefixed phone', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: '+234' + agentPhone.slice(1) }), 'phone')
})

test('brand-new phone and email is no conflict', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: '0909' + digits, email: `new_${rid}@example.com` }), null)
})

test('null or empty email is never an email conflict', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: '0909' + digits, email: null }), null)
  assert.equal(await findIdentityConflict(prisma, { phone: '0909' + digits, email: '  ' }), null)
})

test('excludeCustomerId ignores that customer row', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: custPhone, email: mixEmailLower }), 'phone')
  assert.equal(await findIdentityConflict(prisma, { phone: custPhone, email: mixEmailLower }, { excludeCustomerId: custId }), null)
})

test('phone takes priority over email', async () => {
  assert.equal(await findIdentityConflict(prisma, { phone: agentPhone, email: mixEmailLower }), 'phone')
})
