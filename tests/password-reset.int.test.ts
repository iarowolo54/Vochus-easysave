// Forgot-password, agent unlock and session-ending behaviour against the local DB.
// Run from a worktree only, after confirming its Prisma client points at its own dev.db.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'
import { decodeJwt } from 'jose'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import {
  IP_GUESSES_PER_15_MIN,
  IP_REQUESTS_PER_HOUR,
  MAX_FAILED_GUESSES_PER_DAY,
  MAX_SENDS_PER_DAY,
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  deliverInBackground,
  hmacCode,
  issueAdminResetCode,
  issueResetCode,
  newResetId,
  resetIpLimiterForTests,
  verifyResetCode,
} from '../src/lib/password-reset'

const rid = Math.random().toString(36).slice(2, 8)
let seq = 0

let currentToken = ''
let stubbedAgentId: string | null = null
let stubbedAdmin: { user: { id: string; role: string; name: string } } | null = null
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

const authPath = require_.resolve('next-auth')
const realAuth = require_(authPath) as Record<string, unknown>
require_.cache[authPath]!.exports = new Proxy(realAuth, {
  get: (t, k) => (k === 'getServerSession' ? async () => stubbedAdmin ?? (stubbedAgentId ? { user: { agentId: stubbedAgentId } } : null) : t[k as string]),
})

function req(body: unknown, ip: string | null = null) {
  return {
    json: async () => body,
    headers: { get: (n: string) => (n === 'x-forwarded-for' ? ip : null) },
  } as never
}

let agentPk = ''
let agentCode = ''

async function mkAgent(over: Record<string, unknown> = {}) {
  seq++
  return prisma.agent.create({
    data: { agentId: `PR-${rid}-${seq}`.toUpperCase(), phone: `07${rid}${seq}`, name: 'Test Agent', location: 'Lagos', password: await bcrypt.hash('oldpass', 4), ...over },
  })
}

async function mkCustomer(over: Record<string, unknown> = {}) {
  seq++
  return prisma.customer.create({
    data: {
      customerId: `PRC-${rid}-${seq}`, agentId: agentPk, firstName: 'Ada', lastName: 'Obi', phone: `08${rid}${seq}`,
      email: null, address: 'x', nokName: 'n', nokRelation: 's', nokPhone: '0800', password: await bcrypt.hash('oldpass', 4), ...over,
    },
  })
}

const wrong = (code: string) => (code === '000000' ? '000001' : '000000')

before(async () => {
  const a = await mkAgent()
  agentPk = a.id
  agentCode = a.agentId
})

beforeEach(() => resetIpLimiterForTests())

after(async () => {
  await prisma.$disconnect()
})

// ── Codes ───────────────────────────────────────────────────────────────────

test('stores only a keyed hash of the code, and fails closed with no secret', async () => {
  const c = await mkCustomer()
  const issued = (await issueResetCode('customer', c.id))!
  const row = await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id: issued.id } })
  assert.notEqual(row.codeHash, issued.code)
  assert.notEqual(row.codeHash, createHash('sha256').update(issued.code).digest('hex'), 'not a plain SHA-256')
  assert.equal(row.resetId, issued.resetId)

  const other = await mkCustomer()
  const secret = process.env.NEXTAUTH_SECRET
  const original = console.error
  console.error = () => {}
  try {
    delete process.env.NEXTAUTH_SECRET
    assert.equal(await issueResetCode('customer', other.id), null)
  } finally {
    process.env.NEXTAUTH_SECRET = secret
    console.error = original
  }
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: other.id } }), 0)
})

test('a correct code works within the limit, and only once', async () => {
  const c = await mkCustomer()
  const { code, resetId } = (await issueResetCode('customer', c.id))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS - 1; i++) assert.equal(await verifyResetCode('customer', c.id, resetId, wrong(code)), false)
  assert.equal(await verifyResetCode('customer', c.id, resetId, code), true)
  assert.equal(await verifyResetCode('customer', c.id, resetId, code), false)
})

test('too many wrong codes cancel that code, once, with an audit entry', async () => {
  const c = await mkCustomer()
  const { code, id, resetId } = (await issueResetCode('customer', c.id))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) assert.equal(await verifyResetCode('customer', c.id, resetId, wrong(code)), false)
  assert.equal(await verifyResetCode('customer', c.id, resetId, code), false, 'the right code no longer works')
  assert.ok((await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id } })).consumedAt)
  const audits = await prisma.auditLog.findMany({ where: { action: 'password_reset_locked', entityId: c.id } })
  assert.equal(audits.length, 1)
  assert.doesNotMatch(audits[0].details ?? '', new RegExp(code))
})

test('a burst of concurrent guesses gets no more than the limit', async () => {
  const c = await mkCustomer()
  const { code, id, resetId } = (await issueResetCode('customer', c.id))!
  await Promise.all(Array.from({ length: 20 }, () => verifyResetCode('customer', c.id, resetId, wrong(code))))
  const row = await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id } })
  assert.ok(row.attempts <= MAX_VERIFY_ATTEMPTS, `attempts was ${row.attempts}`)
  assert.equal(await verifyResetCode('customer', c.id, resetId, code), false)
})

test('a stranger’s wrong guesses can’t touch the owner’s code', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const owner = (await issueResetCode('customer', c.id, t0))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS + 2; i++) {
    assert.equal(await verifyResetCode('customer', c.id, newResetId(), wrong(owner.code), t0 + 1), false)
    assert.equal(await verifyResetCode('customer', c.id, '', wrong(owner.code), t0 + 1), false)
  }
  assert.equal((await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id: owner.id } })).attempts, 0)

  const stranger = (await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) await verifyResetCode('customer', c.id, stranger.resetId, wrong(stranger.code), t0 + RESEND_COOLDOWN_MS)
  assert.equal(await verifyResetCode('customer', c.id, owner.resetId, owner.code, t0 + RESEND_COOLDOWN_MS), true, 'owner’s code survived')
})

test('a code only works with its own resetId, and success retires the others', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const first = (await issueResetCode('customer', c.id, t0))!
  const second = (await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS))!
  const at = t0 + RESEND_COOLDOWN_MS
  assert.equal(await verifyResetCode('customer', c.id, second.resetId, first.code === second.code ? wrong(first.code) : first.code, at), false)
  assert.equal(await verifyResetCode('customer', c.id, second.resetId, second.code, at), true)
  assert.equal(await verifyResetCode('customer', c.id, first.resetId, first.code, at), false)
})

test('a request inside the cooldown sends nothing and leaves the code valid', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const first = (await issueResetCode('customer', c.id, t0))!
  assert.equal(await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS - 1), null)
  assert.equal(await verifyResetCode('customer', c.id, first.resetId, first.code, t0 + 1000), true)
})

test('the daily cap stops sends, and clears as the day rolls on', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  for (let i = 0; i < MAX_SENDS_PER_DAY; i++) assert.ok(await issueResetCode('customer', c.id, t0 + i * RESEND_COOLDOWN_MS))
  assert.equal(await issueResetCode('customer', c.id, t0 + MAX_SENDS_PER_DAY * RESEND_COOLDOWN_MS), null)
  assert.ok(await issueResetCode('customer', c.id, t0 + 24 * 60 * 60_000 + 1))
})

test('the per-account guess ceiling stops guesses, with one audit entry', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  await prisma.passwordResetOtp.create({ data: { actorType: 'customer', actorId: c.id, codeHash: 'x', expiresAt: new Date(t0 - 1), attempts: MAX_FAILED_GUESSES_PER_DAY, createdAt: new Date(t0 - 1000) } })
  const { code, resetId } = (await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS))!
  assert.equal(await verifyResetCode('customer', c.id, resetId, code, t0 + RESEND_COOLDOWN_MS), false)
  assert.equal(await verifyResetCode('customer', c.id, resetId, code, t0 + RESEND_COOLDOWN_MS), false)
  assert.equal(await prisma.auditLog.count({ where: { action: 'password_reset_guess_ceiling', entityId: c.id } }), 1)
})

test('an expired code fails', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const { code, resetId } = (await issueResetCode('customer', c.id, t0))!
  assert.equal(await verifyResetCode('customer', c.id, resetId, code, t0 + OTP_TTL_MS + 1), false)
})

test('a customer code can’t be used by a different account', async () => {
  const [a, b] = [await mkCustomer(), await mkCustomer()]
  const { code, resetId } = (await issueResetCode('customer', a.id))!
  assert.equal(await verifyResetCode('customer', b.id, resetId, code), false)
  assert.equal(await verifyResetCode('agent', a.id, resetId, code), false)
})

test('a failed send cancels only that code and keeps the cooldown', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const old = (await issueResetCode('customer', c.id, t0))!
  const failed = (await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS))!
  const original = console.error
  console.error = () => {}
  try {
    deliverInBackground(failed.id, async () => false)
    await new Promise(r => setTimeout(r, 200))
  } finally { console.error = original }
  assert.ok((await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id: failed.id } })).consumedAt)
  assert.equal(await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS + 1), null, 'cooldown still applies')
  assert.equal(await verifyResetCode('customer', c.id, old.resetId, old.code, t0 + RESEND_COOLDOWN_MS + 2), true, 'the older code survives')
})

test('concurrent requests can only create one code', async () => {
  const c = await mkCustomer()
  const results = await Promise.all(Array.from({ length: 10 }, () => issueResetCode('customer', c.id)))
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: c.id } }), 1)
})

test('dates written by the atomic insert read back correctly through Prisma', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  const { id } = (await issueResetCode('customer', c.id, t0))!
  const row = await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id } })
  assert.equal(row.createdAt.getTime(), t0)
  assert.equal(row.expiresAt.getTime(), t0 + OTP_TTL_MS)
})

// ── Customer routes ─────────────────────────────────────────────────────────

test('customer request: known and unknown phones get the same answer', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/route')
  const c = await mkCustomer()
  const shape = async (r: Response) => {
    assert.equal(r.status, 200)
    const b = await r.json()
    assert.deepEqual(Object.keys(b).sort(), ['resetId', 'sent'])
    assert.equal(b.sent, true)
    assert.match(b.resetId, /^[0-9a-f]{32}$/)
    return b.resetId as string
  }
  const known = await shape(await POST(req({ phone: c.phone })))
  await shape(await POST(req({ phone: c.phone })))
  await shape(await POST(req({ phone: `09${rid}999` })))
  assert.equal((await prisma.passwordResetOtp.findFirstOrThrow({ where: { actorId: c.id } })).resetId, known)
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: c.id } }), 1)
})

test('customer reset: unknown phone and wrong code get the same answer', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  const c = await mkCustomer()
  const { code, resetId } = (await issueResetCode('customer', c.id))!
  const wrongCode = await POST(req({ phone: c.phone, code: wrong(code), resetId, newPassword: 'newpass1' }))
  const unknown = await POST(req({ phone: `09${rid}998`, code: '123456', resetId: newResetId(), newPassword: 'newpass1' }))
  assert.equal(wrongCode.status, 400)
  assert.equal(unknown.status, 400)
  assert.equal(JSON.stringify(await wrongCode.json()), JSON.stringify(await unknown.json()))
})

test('codes from the shared OTP tables no longer reset a password', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  const c = await mkCustomer({ email: `pr-${rid}-${seq}@example.com` })
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)
  await prisma.phoneOTP.create({ data: { phone: c.phone, code: '111111', expiresAt } })
  await prisma.emailOTP.create({ data: { email: c.email!, code: '222222', expiresAt } })
  for (const code of ['111111', '222222']) {
    const res = await POST(req({ phone: c.phone, code, newPassword: 'newpass1' }))
    assert.equal(res.status, 400)
  }
  const after_ = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.ok(await bcrypt.compare('oldpass', after_.password!))
})

test('customer reset sets a first password on an agent-created account', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  const c = await mkCustomer({ password: null })
  const { code, resetId } = (await issueResetCode('customer', c.id))!
  const res = await POST(req({ phone: c.phone, code, resetId, newPassword: 'firstpass' }))
  assert.equal(res.status, 200)
  const after_ = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.ok(await bcrypt.compare('firstpass', after_.password!))
})

test('customer reset ends old sessions and fingerprint tokens', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  const { getCustomerSession, signCustomerToken } = await import('../src/lib/customer-auth')
  const c = await mkCustomer()
  const payload = { id: c.id, customerId: c.customerId, name: 'Ada Obi', agentId: agentPk }
  currentToken = await signCustomerToken(payload)
  assert.ok(await getCustomerSession(), 'session valid before reset')
  const bio = await prisma.biometricToken.create({ data: { customerId: c.id, deviceId: 'd1', tokenHash: 'h' } })

  const { code, resetId } = (await issueResetCode('customer', c.id))!
  assert.equal((await POST(req({ phone: c.phone, code, resetId, newPassword: 'newpass1' }))).status, 200)

  assert.equal(await getCustomerSession(), null, 'old session rejected')
  assert.ok((await prisma.biometricToken.findUniqueOrThrow({ where: { id: bio.id } })).revokedAt)
  currentToken = await signCustomerToken({ ...payload, tokenVersion: 1 })
  assert.ok(await getCustomerSession(), 'a new sign-in works')
  currentToken = ''
})

// ── Customer token versioning ───────────────────────────────────────────────

test('a token with no version claim stays valid at version 0, so a deploy signs nobody out', async () => {
  const { getCustomerSession, signCustomerToken } = await import('../src/lib/customer-auth')
  const c = await mkCustomer()
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'Ada Obi', agentId: agentPk })
  assert.equal((await getCustomerSession())?.id, c.id)
  currentToken = ''
})

test('a session for a missing customer fails closed', async () => {
  const { getCustomerSession, signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: `missing-${rid}`, customerId: 'x', name: 'x', agentId: agentPk })
  assert.equal(await getCustomerSession(), null)
  currentToken = ''
})

test('the proxy keeps the version claim when it re-issues the cookie', async () => {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  const { proxy } = await import('../src/proxy')
  const payload = { id: 'x', customerId: 'x', name: 'x', agentId: 'x' }
  const reissue = async (token: string) => {
    const res = await proxy(new NextRequest('http://localhost/api/session/ping', { headers: { cookie: `customer_token=${token}` } }))
    const value = res.cookies.get('customer_token')?.value
    assert.ok(value, 'cookie was re-issued')
    return decodeJwt(value)
  }
  const loginAt = Math.floor(Date.now() / 1000)
  assert.equal((await reissue(await signCustomerToken({ ...payload, tokenVersion: 3 }, { loginAt }))).tokenVersion, 3)
  assert.equal((await reissue(await signCustomerToken(payload, { loginAt }))).tokenVersion, undefined)
})

// ── Limits by IP ────────────────────────────────────────────────────────────

test('requests are limited per IP, without affecting another IP', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/route')
  const unknownPhone = `09${rid}997`
  for (let i = 0; i < IP_REQUESTS_PER_HOUR; i++) assert.equal((await POST(req({ phone: unknownPhone }, '10.0.0.1'))).status, 200)
  const blocked = await POST(req({ phone: unknownPhone }, '10.0.0.1'))
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0)
  assert.equal((await POST(req({ phone: unknownPhone }, '10.0.0.2'))).status, 200)
})

test('guesses are limited per IP across different phones', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  for (let i = 0; i < IP_GUESSES_PER_15_MIN; i++) {
    assert.equal((await POST(req({ phone: `09${rid}${i}`, code: '123456', newPassword: 'newpass1' }, '10.0.0.3'))).status, 400)
  }
  assert.equal((await POST(req({ phone: `09${rid}x`, code: '123456', newPassword: 'newpass1' }, '10.0.0.3'))).status, 429)
})

// ── Agent routes ────────────────────────────────────────────────────────────

test('agent request: known, no-email and unknown get the same answer', async () => {
  const { POST } = await import('../src/app/api/agent/forgot-password/route')
  const noEmail = await mkAgent({ email: null })
  const a = await POST(req({ identifier: noEmail.agentId }))
  const b = await POST(req({ identifier: `NOPE-${rid}` }))
  assert.equal(a.status, 200)
  assert.deepEqual(Object.keys(await a.json()).sort(), Object.keys(await b.json()).sort())
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: noEmail.id } }), 0)
})

test('agent reset ends old sessions and fingerprint tokens, and clears the lock', async () => {
  const { POST } = await import('../src/app/api/agent/forgot-password/reset/route')
  const { authOptions } = await import('../src/lib/auth')
  const a = await mkAgent({ lockedAt: new Date(), loginAttempts: 3 })
  const bio = await prisma.biometricToken.create({ data: { agentId: a.id, deviceId: 'd2', tokenHash: 'h2' } })
  const sessionCb = authOptions.callbacks!.session!
  const check = () => sessionCb({ session: { user: {} }, token: { agentId: a.agentId, tokenVersion: 0 } } as never) as unknown as Promise<{ user?: unknown }>
  assert.ok((await check()).user, 'session valid before reset')

  const { code, resetId } = (await issueResetCode('agent', a.id))!
  assert.equal((await POST(req({ identifier: a.agentId, code: wrong(code), resetId, newPassword: 'newpass1' }))).status, 400)
  assert.equal((await POST(req({ identifier: a.agentId, code, resetId, newPassword: 'newpass1' }))).status, 200)

  const after_ = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(after_.tokenVersion, 1)
  assert.equal(after_.lockedAt, null)
  assert.equal(after_.loginAttempts, 0)
  assert.ok(await bcrypt.compare('newpass1', after_.password))
  assert.ok((await prisma.biometricToken.findUniqueOrThrow({ where: { id: bio.id } })).revokedAt)
  assert.equal((await check()).user, undefined, 'old session rejected')
})

test('agent unlock: answers the same for unknown and unlocked, and sends only when locked', async () => {
  const { POST } = await import('../src/app/api/agent/unlock/request/route')
  const unlocked = await mkAgent()
  const locked = await mkAgent({ lockedAt: new Date() })
  const r1 = await POST(req({ identifier: unlocked.agentId }))
  const r2 = await POST(req({ identifier: `NOPE-${rid}` }))
  const r3 = await POST(req({ identifier: locked.agentId }))
  const keys = Object.keys(await r1.json()).sort()
  assert.deepEqual(keys, ['ok', 'resetId'])
  assert.deepEqual(Object.keys(await r2.json()).sort(), keys)
  assert.deepEqual(Object.keys(await r3.json()).sort(), keys)
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: unlocked.id } }), 0)
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: locked.id } }), 1)
})

test('agent unlock reset: limited guesses, ignores the old token column, ends sessions', async () => {
  const { POST } = await import('../src/app/api/agent/unlock/reset/route')
  const a = await mkAgent({ lockedAt: new Date(), unlockToken: '333333', unlockTokenExpiry: new Date(Date.now() + OTP_TTL_MS) })
  const bio = await prisma.biometricToken.create({ data: { agentId: a.id, deviceId: 'd3', tokenHash: 'h3' } })
  assert.equal((await POST(req({ identifier: a.agentId, token: '333333', newPin: '123456' }))).status, 400)

  const { code, resetId } = (await issueResetCode('agent', a.id, Date.now(), 'unlock'))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
    assert.equal((await POST(req({ identifier: a.agentId, token: wrong(code), resetId, newPin: '123456' }))).status, 400)
  }
  assert.equal((await POST(req({ identifier: a.agentId, token: code, resetId, newPin: '123456' }))).status, 400, 'cancelled after the limit')

  const fresh = (await issueResetCode('agent', a.id, Date.now() + RESEND_COOLDOWN_MS, 'unlock'))!
  assert.equal((await POST(req({ identifier: a.agentId, token: fresh.code, resetId: fresh.resetId, newPin: '12345' }))).status, 400, 'too short')
  const ok = await verifyAndReset(POST, a.agentId, fresh.code, fresh.resetId)
  assert.equal(ok, true)
  const after_ = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(after_.tokenVersion, 1)
  assert.equal(after_.lockedAt, null)
  assert.ok((await prisma.biometricToken.findUniqueOrThrow({ where: { id: bio.id } })).revokedAt)
})

async function verifyAndReset(POST: (r: never) => Promise<Response>, identifier: string, token: string, resetId: string) {
  return (await POST(req({ identifier, token, resetId, newPin: '123456' }))).status === 200
}

// ── Paid dates ──────────────────────────────────────────────────────────────

test('paid-dates: 404 for another agent’s plan, 200 for the owner', async () => {
  const { GET } = await import('../src/app/api/transactions/saving/paid-dates/route')
  const other = await mkAgent()
  const c = await mkCustomer()
  const start = new Date()
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: start, maturityDate: new Date(start.getTime() + 30 * 86400000) },
  })
  const call = () => GET(new NextRequest(`http://localhost/api/transactions/saving/paid-dates?planId=${plan.id}`))

  stubbedAgentId = other.agentId
  assert.equal((await call()).status, 404)

  stubbedAgentId = agentCode
  const res = await call()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.paidDates, [])
  assert.ok(body.planStartDate)

  stubbedAgentId = null
  assert.equal((await call()).status, 401)
})

// ── Non-string values (Prisma filter objects) ───────────────────────────────

const BAD_VALUES: unknown[] = [{ not: '' }, { contains: '' }, ['123456'], 123456, null, true]

test('customer reset refuses non-string codes and passwords', async () => {
  const { POST } = await import('../src/app/api/customer/forgot-password/reset/route')
  const c = await mkCustomer()
  const { id, resetId } = (await issueResetCode('customer', c.id))!
  for (const code of BAD_VALUES) assert.equal((await POST(req({ phone: c.phone, code, resetId, newPassword: 'hacked123' }))).status, 400)
  for (const bad of BAD_VALUES) assert.equal((await POST(req({ phone: c.phone, code: '123456', resetId: bad, newPassword: 'hacked123' }))).status, 400)
  for (const phone of BAD_VALUES) assert.equal((await POST(req({ phone, code: '123456', newPassword: 'hacked123' }))).status, 400)
  for (const newPassword of [{ a: 1 }, ['hacked123'], 12345678]) assert.equal((await POST(req({ phone: c.phone, code: '123456', newPassword }))).status, 400)
  const after_ = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.ok(await bcrypt.compare('oldpass', after_.password!))
  assert.equal(after_.tokenVersion, 0)
  assert.equal((await prisma.passwordResetOtp.findUniqueOrThrow({ where: { id } })).attempts, 0, 'malformed input uses no attempts')
})

test('agent reset and agent unlock refuse non-string codes and passwords', async () => {
  const reset = (await import('../src/app/api/agent/forgot-password/reset/route')).POST
  const unlock = (await import('../src/app/api/agent/unlock/reset/route')).POST
  const a = await mkAgent({ lockedAt: new Date() })
  const { resetId } = (await issueResetCode('agent', a.id))!
  for (const code of BAD_VALUES) {
    assert.equal((await reset(req({ identifier: a.agentId, code, resetId, newPassword: 'hacked123' }))).status, 400)
    assert.equal((await unlock(req({ identifier: a.agentId, token: code, resetId, newPin: '999999' }))).status, 400)
  }
  for (const identifier of BAD_VALUES) {
    assert.equal((await reset(req({ identifier, code: '123456', newPassword: 'hacked123' }))).status, 400)
    assert.equal((await unlock(req({ identifier, token: '123456', newPin: '9999' }))).status, 400)
  }
  for (const value of [{ a: 1 }, ['hacked123'], 12345678]) {
    assert.equal((await reset(req({ identifier: a.agentId, code: '123456', newPassword: value }))).status, 400)
    assert.equal((await unlock(req({ identifier: a.agentId, token: '123456', newPin: value }))).status, 400)
  }
  const after_ = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.ok(await bcrypt.compare('oldpass', after_.password))
  assert.equal(after_.tokenVersion, 0)
  assert.ok(after_.lockedAt)
})

test('otp/verify refuses non-strings, checks the format, and accepts the right code', async () => {
  const { POST } = await import('../src/app/api/otp/verify/route')
  const phone = `081${rid}1`
  const row = await prisma.phoneOTP.create({ data: { phone, code: hmacCode('phone-otp', '654321'), expiresAt: new Date(Date.now() + OTP_TTL_MS) } })
  stubbedAgentId = null
  assert.equal((await POST(req({ phone, code: '654321' }))).status, 401)
  stubbedAgentId = agentCode
  for (const code of BAD_VALUES) assert.equal((await POST(req({ phone, code }))).status, 400)
  for (const p of BAD_VALUES) assert.equal((await POST(req({ phone: p, code: '654321' }))).status, 400)
  assert.equal((await POST(req({ phone, code: 'abcdef' }))).status, 400)
  assert.equal((await prisma.phoneOTP.findUniqueOrThrow({ where: { id: row.id } })).verified, false)
  assert.equal((await POST(req({ phone, code: '111111' }))).status, 400)
  assert.equal((await POST(req({ phone, code: '654321' }))).status, 200)
  assert.equal((await prisma.phoneOTP.findUniqueOrThrow({ where: { id: row.id } })).verified, true)
})

test('otp/verify limits guesses per phone', async () => {
  const { POST } = await import('../src/app/api/otp/verify/route')
  const phone = `081${rid}2`
  await prisma.phoneOTP.create({ data: { phone, code: hmacCode('phone-otp', '654321'), expiresAt: new Date(Date.now() + OTP_TTL_MS) } })
  stubbedAgentId = agentCode
  for (let i = 0; i < 10; i++) assert.equal((await POST(req({ phone, code: '111111' }))).status, 400)
  assert.equal((await POST(req({ phone, code: '654321' }))).status, 429)
})

test('onboarding verify refuses non-strings and cancels after 5 wrong codes', async () => {
  const { POST } = await import('../src/app/api/agent/onboard/[token]/verify-otp/route')
  const email = `invite-${rid}@example.com`
  const token = `tok-${rid}`
  await prisma.agentInvite.create({ data: { email, token, expiresAt: new Date(Date.now() + 86400000) } })
  const call = (code: unknown) => POST(req({ code }) as never, { params: Promise.resolve({ token }) })
  const row = await prisma.emailOTP.create({ data: { email, code: '654321', expiresAt: new Date(Date.now() + OTP_TTL_MS) } })
  for (const code of BAD_VALUES) assert.equal((await call(code)).status, 400)
  assert.equal((await prisma.emailOTP.findUniqueOrThrow({ where: { id: row.id } })).verified, false)
  assert.equal((await call('654321')).status, 200, 'right code works')
  await prisma.emailOTP.updateMany({ where: { email }, data: { verified: false } })
  await prisma.emailOTP.update({ where: { id: row.id }, data: { attempts: 0 } })
  for (let i = 0; i < 5; i++) assert.equal((await call('111111')).status, 400)
  assert.equal((await call('654321')).status, 400, 'cancelled after the limit')
  assert.equal((await prisma.emailOTP.findUniqueOrThrow({ where: { id: row.id } })).verified, false)
})

test('customer login ignores non-string device and fingerprint values', async () => {
  const { POST } = await import('../src/app/api/customer/auth/login/route')
  const c = await mkCustomer()
  await prisma.biometricToken.create({ data: { customerId: c.id, deviceId: 'real-device', tokenHash: 'h' } })
  const res = await POST(req({ phone: c.phone, biometricToken: { not: '' }, deviceId: { not: '' } }))
  assert.equal(res.status, 400)
})

test('customer login puts the current token version in the session', async () => {
  const { POST } = await import('../src/app/api/customer/auth/login/route')
  const c = await mkCustomer({ tokenVersion: 4 })
  const res = await POST(req({ phone: c.phone, password: 'oldpass' }))
  assert.equal(res.status, 200)
  assert.equal(decodeJwt(res.cookies.get('customer_token')!.value).tokenVersion, 4)
})

test('reset and unlock codes only work on their own route', async () => {
  const unlock = (await import('../src/app/api/agent/unlock/reset/route')).POST
  const reset = (await import('../src/app/api/agent/forgot-password/reset/route')).POST
  const a = await mkAgent({ lockedAt: new Date() })
  const t0 = Date.now()
  const r = (await issueResetCode('agent', a.id, t0, 'reset'))!
  assert.equal((await unlock(req({ identifier: a.agentId, token: r.code, resetId: r.resetId, newPin: '123456' }))).status, 400)
  const u = (await issueResetCode('agent', a.id, t0 + RESEND_COOLDOWN_MS, 'unlock'))!
  assert.equal((await reset(req({ identifier: a.agentId, code: u.code, resetId: u.resetId, newPassword: 'newpass1' }))).status, 400)

  // A lock can clear while a code is on its way, and a stranger's wrong login mustn't kill a valid code.
  const cleared = await mkAgent()
  const c = (await issueResetCode('agent', cleared.id, t0, 'unlock'))!
  assert.equal((await unlock(req({ identifier: cleared.agentId, token: c.code, resetId: c.resetId, newPin: '123456' }))).status, 200)
})

test('hitting the daily cap writes one audit entry', async () => {
  const c = await mkCustomer()
  const t0 = Date.now()
  for (let i = 0; i < MAX_SENDS_PER_DAY; i++) assert.ok(await issueResetCode('customer', c.id, t0 + i * RESEND_COOLDOWN_MS))
  const later = t0 + MAX_SENDS_PER_DAY * RESEND_COOLDOWN_MS
  assert.equal(await issueResetCode('customer', c.id, later), null)
  assert.equal(await issueResetCode('customer', c.id, later + RESEND_COOLDOWN_MS), null)
  assert.equal(await prisma.auditLog.count({ where: { action: 'password_reset_daily_cap', entityId: c.id } }), 1)
})

test('the proxy’s token module doesn’t load Prisma', async () => {
  const { readFileSync } = await import('node:fs')
  assert.doesNotMatch(readFileSync('src/lib/customer-token.ts', 'utf8'), /from ['"].*prisma/)
  assert.match(readFileSync('src/proxy.ts', 'utf8'), /from '@\/lib\/customer-token'/)
  assert.doesNotMatch(readFileSync('src/proxy.ts', 'utf8'), /customer-auth'/)
})

// ── otp/send ────────────────────────────────────────────────────────────────

test('otp/send needs an agent session, stores a hash, and limits per phone', async () => {
  const { POST } = await import('../src/app/api/otp/send/route')
  const phone = `0803${String(Date.now()).slice(-7)}`
  stubbedAgentId = null
  assert.equal((await POST(req({ phone }))).status, 401)
  stubbedAgentId = agentCode
  for (const bad of BAD_VALUES) assert.equal((await POST(req({ phone: bad }))).status, 400)
  assert.equal((await POST(req({ phone }))).status, 200)
  const row = await prisma.phoneOTP.findFirstOrThrow({ where: { phone } })
  assert.equal(row.code.length, 64, 'a hash is stored')
  assert.equal(row.verified, false)
  assert.equal((await POST(req({ phone }))).status, 429, 'cooldown')
  assert.equal(await prisma.phoneOTP.count({ where: { phone } }), 1)
  stubbedAgentId = null
})

// ── Customer unlock ─────────────────────────────────────────────────────────

test('customer unlock request answers the same for unknown phones, and is limited per IP', async () => {
  const { POST } = await import('../src/app/api/customer/auth/unlock/request/route')
  for (let i = 0; i < IP_REQUESTS_PER_HOUR; i++) {
    const r = await POST(req({ phone: `09${rid}996` }, '10.0.0.9'))
    assert.deepEqual(await r.json(), { ok: true })
  }
  assert.equal((await POST(req({ phone: `09${rid}996` }, '10.0.0.9'))).status, 429)
})

// ── Onboarding ──────────────────────────────────────────────────────────────

test('onboarding needs a recent verified email, and a resend can’t reset the limit', async () => {
  const onboard = (await import('../src/app/api/agent/onboard/[token]/route')).POST
  const send = (await import('../src/app/api/agent/onboard/[token]/send-otp/route')).POST
  const email = `invite2-${rid}@example.com`
  const token = `tok2-${rid}`
  await prisma.agentInvite.create({ data: { email, token, expiresAt: new Date(Date.now() + 86400000) } })
  const params = { params: Promise.resolve({ token }) }
  const fields = { firstName: 'A', lastName: 'B', phone: `07${rid}77`, state: 'Lagos', address: 'x', nokName: 'n', nokPhone: '0800', password: 'password1' }
  const res = await onboard(req(fields) as never, params)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /Confirm your email/)

  await send(req({}) as never, params).catch(() => {})
  assert.equal((await send(req({}) as never, params)).status, 429)
  assert.equal(await prisma.emailOTP.count({ where: { email } }), 1)
})

// ── Repayment ───────────────────────────────────────────────────────────────

test('loan repay: Disbursed only, and concurrent payments can’t overpay', async () => {
  const { POST } = await import('../src/app/api/loans/[id]/repay/route')
  stubbedAgentId = agentCode
  const c = await mkCustomer()
  const mkLoan = (status: string, n: number) => prisma.loan.create({
    data: { ref: `LN-${rid}-${n}`, agentId: agentPk, customerId: c.id, principal: 900, interestRate: 0, interestAmount: 100, totalAmount: 1000, durationDays: 30, dueDate: new Date(Date.now() + 86400000), status },
  })
  const call = (id: string, amount: unknown, method?: unknown) => POST(req({ amount, method }) as never, { params: Promise.resolve({ id }) })

  const approved = await mkLoan('Approved', 1)
  assert.equal((await call(approved.id, 100)).status, 400, 'Approved is refused')

  const loan = await mkLoan('Disbursed', 2)
  assert.equal((await call(loan.id, 1001)).status, 400, 'over the balance')
  assert.equal((await call(loan.id, { not: 0 })).status, 400)

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => call(loan.id, 400)))
  const paid = await prisma.loanRepayment.aggregate({ where: { loanId: loan.id }, _sum: { amount: true } })
  assert.ok((paid._sum.amount ?? 0) <= 1000, `paid ${paid._sum.amount}`)
  assert.ok(results.some(r => r.status === 'fulfilled' && r.value.status === 200))

  const ok = await mkLoan('Disbursed', 3)
  const res = await call(ok.id, 1000, { evil: true })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).fullyRepaid, true)
  assert.equal((await prisma.loan.findUniqueOrThrow({ where: { id: ok.id } })).status, 'Repaid')
  assert.equal((await prisma.loanRepayment.findFirstOrThrow({ where: { loanId: ok.id } })).method, 'Cash')
  stubbedAgentId = null
})

// ── resolve-account ─────────────────────────────────────────────────────────

test('resolve-account needs a session and valid input', async () => {
  const { GET, POST } = await import('../src/app/api/paystack/resolve-account/route')
  const get = (q: string) => GET(new NextRequest(`http://localhost/api/paystack/resolve-account?${q}`))
  stubbedAgentId = null
  currentToken = ''
  assert.equal((await get('accountNumber=0123456789&bankCode=058')).status, 401)
  assert.equal((await POST(req({ accountNumber: '0123456789', bankCode: '058' }) as never)).status, 401)
  stubbedAgentId = agentCode
  assert.equal((await get('accountNumber=12ab&bankCode=058')).status, 400)
  assert.equal((await get('accountNumber=0123456789&bankCode=05%208')).status, 400)
  assert.equal((await POST(req({ accountNumber: { not: '' }, bankCode: '058' }) as never)).status, 400)
  stubbedAgentId = null
})

// ── Admin recovery ──────────────────────────────────────────────────────────

test('admin code skips the limits, needs admin and PIN, is audited, and works on the normal reset', async () => {
  const route = (await import('../src/app/api/admin/password-reset/route')).POST
  const reset = (await import('../src/app/api/customer/forgot-password/reset/route')).POST
  const c = await mkCustomer()
  const t0 = Date.now()
  for (let i = MAX_SENDS_PER_DAY; i > 0; i--) assert.ok(await issueResetCode('customer', c.id, t0 - i * RESEND_COOLDOWN_MS))
  assert.equal(await issueResetCode('customer', c.id, t0 + RESEND_COOLDOWN_MS), null, 'daily cap reached')

  // No admin session: the stub session has no superadmin role.
  stubbedAgentId = agentCode
  assert.equal((await route(req({ actorType: 'customer', id: c.id, pin: '1234' }))).status, 403)
  stubbedAgentId = null
  assert.equal((await route(req({ actorType: 'customer', id: c.id, pin: '1234' }))).status, 401)

  const { code, resetId } = await issueAdminResetCode('customer', c.id, t0)
  assert.equal((await reset(req({ phone: c.phone, code, resetId, newPassword: 'adminpass1' }))).status, 200)
  const after_ = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  assert.ok(await bcrypt.compare('adminpass1', after_.password!))
  assert.equal(after_.tokenVersion, 1)
})

test('reset and unlock keep separate limits', async () => {
  const a = await mkAgent({ lockedAt: new Date() })
  const t0 = Date.now()
  assert.ok(await issueResetCode('agent', a.id, t0, 'reset'))
  assert.ok(await issueResetCode('agent', a.id, t0 + 1, 'unlock'), 'a reset request doesn’t block an unlock')
  assert.equal(await issueResetCode('agent', a.id, t0 + 2, 'unlock'), null)
})

test('admin route: wrong PIN refused; right PIN sends past the cap, audits, and never returns the code', async () => {
  const route = (await import('../src/app/api/admin/password-reset/route')).POST
  const c = await mkCustomer()
  const a = await mkAgent({ email: null })
  const admin = await prisma.superAdmin.create({
    data: { email: `admin-${rid}@example.com`, name: 'Test Admin', password: 'x', approvalPin: await bcrypt.hash('4321', 4) },
  })
  stubbedAdmin = { user: { id: admin.id, role: 'superadmin', name: 'Test Admin' } }
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  const t0 = Date.now()
  for (let i = MAX_SENDS_PER_DAY; i > 0; i--) assert.ok(await issueResetCode('customer', c.id, t0 - i * RESEND_COOLDOWN_MS))
  try {
    assert.equal((await route(req({ actorType: 'customer', id: c.id, pin: '0000' }))).status, 403)
    assert.equal((await route(req({ actorType: 'nobody', id: c.id, pin: '4321' }))).status, 400)
    assert.equal((await route(req({ actorType: 'customer', id: { not: '' }, pin: '4321' }))).status, 400)
    assert.equal((await route(req({ actorType: 'customer', id: 'missing', pin: '4321' }))).status, 404)

    const res = await route(req({ actorType: 'customer', id: c.id, pin: '4321' }))
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(Object.keys(body).sort(), ['channel', 'sent', 'sentTo'])
    const row = await prisma.passwordResetOtp.findFirstOrThrow({ where: { actorId: c.id, purpose: 'admin' } })
    assert.ok(row.resetId)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin_password_reset_code_sent', entityId: c.id } })
    assert.equal(audit.actorId, admin.id)

    assert.equal((await route(req({ actorType: 'agent', id: a.id, pin: '4321' }))).status, 200, 'an agent with no email gets SMS')
  } finally {
    stubbedAdmin = null
  }
})

test('a successful reset retires live codes of every purpose', async () => {
  const a = await mkAgent()
  const t0 = Date.now()
  const unlock = (await issueResetCode('agent', a.id, t0, 'unlock'))!
  const admin = await issueAdminResetCode('agent', a.id, t0)
  const reset = (await issueResetCode('agent', a.id, t0, 'reset'))!
  assert.equal(await verifyResetCode('agent', a.id, reset.resetId, reset.code, t0 + 1), true)
  assert.equal(await verifyResetCode('agent', a.id, unlock.resetId, unlock.code, t0 + 1, 'unlock'), false)
  assert.equal(await verifyResetCode('agent', a.id, admin.resetId, admin.code, t0 + 1), false)
})

test('onboarding verify is limited per IP', async () => {
  const { POST } = await import('../src/app/api/agent/onboard/[token]/verify-otp/route')
  const params = { params: Promise.resolve({ token: `none-${rid}` }) }
  for (let i = 0; i < IP_GUESSES_PER_15_MIN; i++) assert.equal((await POST(req({ code: '123456' }, '10.0.0.7') as never, params)).status, 400)
  assert.equal((await POST(req({ code: '123456' }, '10.0.0.7') as never, params)).status, 429)
})
