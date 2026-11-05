// When a customer account hard-locks, sessions already signed in must stop working.
// Runs against the local prisma/dev.db with randomised rows, cleaned up after.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { recordLoginFailure, reserveAccountAttempt, endSessionsIfLocked, unlockAccount } from '../src/lib/login-attempt'
import { ACCOUNT_FAIL_LIMIT } from '../src/lib/login-throttle'

const rid = Math.random().toString(36).slice(2, 10)
const phones: string[] = []
let customerIds: string[] = []
let seq = 0
let agentPk = ''

async function makeCustomer() {
  if (!agentPk) {
    agentPk = (await prisma.agent.create({
      data: { agentId: `LK-${rid}`.toUpperCase(), phone: `08${rid}`, name: 'Test Agent', location: 'Lagos', password: 'x' },
    })).id
  }
  seq++
  const phone = `07${rid}${seq}`
  phones.push(phone)
  const c = await prisma.customer.create({
    data: {
      customerId: `LK-${rid}-${seq}`, agentId: agentPk, firstName: 'Ada', lastName: 'Obi', phone,
      address: 'x', nokName: 'x', nokRelation: 'x', nokPhone: '0', password: 'x',
    },
  })
  customerIds.push(c.id)
  return c
}
const version = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).tokenVersion

after(async () => {
  await prisma.loginAttempt.deleteMany({ where: { OR: phones.map(p => ({ key: `phone:${p}` })) } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  if (agentPk) await prisma.agent.delete({ where: { id: agentPk } })
  await prisma.$disconnect()
})

test('failures below the limit leave sessions alone', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT - 1; i++) await recordLoginFailure({ phone: c.phone })
  assert.equal(await version(c.id), c.tokenVersion)
})

test('the failure that locks the account ends open sessions, once', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT; i++) await recordLoginFailure({ phone: c.phone })
  assert.equal(await version(c.id), c.tokenVersion + 1)
  await recordLoginFailure({ phone: c.phone }) // already locked: no further bump
  assert.equal(await version(c.id), c.tokenVersion + 1)
})

test('the password-change counter alone does not end sessions: a correct fourth try keeps the owner signed in', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT; i++) assert.equal(await reserveAccountAttempt(c.phone), true)
  assert.equal(await version(c.id), c.tokenVersion)
})

test('a wrong password on the locking attempt ends open sessions, and only then', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT - 1; i++) {
    assert.equal(await reserveAccountAttempt(c.phone), true)
    await endSessionsIfLocked(c.phone)
  }
  assert.equal(await version(c.id), c.tokenVersion)
  assert.equal(await reserveAccountAttempt(c.phone), true) // the locking attempt, wrong password
  await endSessionsIfLocked(c.phone)
  assert.equal(await version(c.id), c.tokenVersion + 1)
})

test('a failure while ending sessions does not reset the lock', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT - 1; i++) await recordLoginFailure({ phone: c.phone })
  const orig = prisma.customer.updateMany
  // @ts-expect-error simulate the session bump failing
  prisma.customer.updateMany = () => Promise.reject(new Error('database is locked'))
  try { await recordLoginFailure({ phone: c.phone }) } finally { prisma.customer.updateMany = orig }
  const row = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `phone:${c.phone}` } })
  assert.equal(row.failCount, ACCOUNT_FAIL_LIMIT)
})

test('a lock that is cleared and hit again ends sessions again', async () => {
  const c = await makeCustomer()
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT; i++) await recordLoginFailure({ phone: c.phone })
  await unlockAccount(c.phone)
  for (let i = 0; i < ACCOUNT_FAIL_LIMIT; i++) await recordLoginFailure({ phone: c.phone })
  assert.equal(await version(c.id), c.tokenVersion + 2)
})
