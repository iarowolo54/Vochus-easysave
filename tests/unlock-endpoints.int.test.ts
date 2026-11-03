// End-to-end test of the unlock endpoints against the local DB. Seeds an agent +
// an SMS (no-email) customer, locks the account, then exercises request + verify.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { POST as requestUnlock } from '../src/app/api/customer/auth/unlock/request/route'
import { POST as verifyUnlock } from '../src/app/api/customer/auth/unlock/verify/route'
import { recordLoginFailure, isPhoneLocked } from '../src/lib/login-attempt'
import { issueResetCode, RESEND_COOLDOWN_MS } from '../src/lib/password-reset'

const rid = Math.random().toString(36).slice(2, 10)
const phone = `0803${Math.floor(1000000 + Math.random() * 8999999)}`
const agentId = `AGT-test-${rid}`
const customerId = `CUST-test-${rid}`
let custPk = ''

function req(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as any
}

before(async () => {
  const agent = await prisma.agent.create({
    data: { agentId, phone: `0700${rid.slice(0, 7)}`, name: 'Test Agent', location: 'Lagos', password: 'x' },
  })
  const cust = await prisma.customer.create({
    data: {
      customerId, agentId: agent.id, firstName: 'Ada', lastName: 'Obi', phone,
      email: null, address: 'x', nokName: 'n', nokRelation: 'sister', nokPhone: '0800',
    },
  })
  custPk = cust.id
})

after(async () => {
  await prisma.passwordResetOtp.deleteMany({ where: { actorId: custPk } })
  await prisma.loginAttempt.deleteMany({ where: { key: `phone:${phone}` } })
  await prisma.auditLog.deleteMany({ where: { entityId: custPk } })
  await prisma.customer.deleteMany({ where: { id: custPk } })
  await prisma.agent.deleteMany({ where: { agentId } })
  await prisma.$disconnect()
})

test('request on a NOT-locked account is neutral (no channel leaked)', async () => {
  const res = await requestUnlock(req({ phone }))
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean; channel?: string }
  assert.equal(body.ok, true)
  assert.equal(body.channel, undefined)
})

test('once locked, request sends a code and answers the same neutral way', async () => {
  for (let i = 0; i < 4; i++) await recordLoginFailure({ phone })
  assert.equal(await isPhoneLocked(phone), true)

  const res = await requestUnlock(req({ phone }))
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean; resetId: string }
  assert.equal(body.ok, true)
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: custPk, purpose: 'login_unlock', resetId: body.resetId } }), 1)
})

test('verify: wrong code 400, correct code unlocks the account', async () => {
  await prisma.passwordResetOtp.updateMany({ where: { attempts: { gt: 0 } }, data: { attempts: 0 } })
  const { code, resetId } = (await issueResetCode('customer', custPk, Date.now() + RESEND_COOLDOWN_MS, 'login_unlock'))!
  await prisma.passwordResetOtp.updateMany({ where: { resetId }, data: { createdAt: new Date() } })
  const wrong = code === '000000' ? '000001' : '000000'

  const missing = await verifyUnlock(req({ phone, code }))
  assert.equal(missing.status, 400, 'needs the resetId')

  const bad = await verifyUnlock(req({ phone, code: wrong, resetId }))
  assert.equal(bad.status, 400)
  assert.equal(await isPhoneLocked(phone), true) // still locked

  const good = await verifyUnlock(req({ phone, code, resetId }))
  assert.equal(good.status, 200)
  assert.equal(await isPhoneLocked(phone), false) // unlocked
})
