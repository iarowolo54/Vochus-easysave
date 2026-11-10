// Integration tests: an agent upload can't run script in a super admin's session, and agent login can't be
// guessed through the fingerprint path or from one address without limit.
//   NEXTAUTH_SECRET=test npx tsx --test tests/agent-security.int.test.ts
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'
import { encode } from 'next-auth/jwt'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { authOptions } from '../src/lib/auth'

const rid = Math.random().toString(36).slice(2, 8).toUpperCase()
const created: string[] = []
const customerIds: string[] = []
const ipKeys: string[] = []
let n = 0

let jar: Record<string, string> = {}
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: {
    cookies: async () => ({
      get: (name: string) => (jar[name] ? { name, value: jar[name] } : undefined),
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      set: () => {},
    }),
    headers: async () => new Headers(),
  },
} as unknown as NodeJS.Module

const PASSWORD = 'correct-horse'
async function mkAgent(extra: Record<string, unknown> = {}) {
  n++
  const a = await prisma.agent.create({
    data: { agentId: `SEC-${rid}-${n}`, phone: `0792${rid}${n}`, name: 'Sec', location: 'x', password: await bcrypt.hash(PASSWORD, 4), requiredDocs: JSON.stringify(['id']), status: 'Active', ...extra },
  })
  created.push(a.id)
  return a
}

const token = (claims: Record<string, unknown>) => encode({ token: { sub: 'x', loginAt: Math.floor(Date.now() / 1000), ...claims }, secret: process.env.NEXTAUTH_SECRET as string })
const asAgent = async (a: { agentId: string; name: string }) => { jar = { 'next-auth.session-token': await token({ name: a.name, agentId: a.agentId, tokenVersion: 0 }) } }
const asAdmin = async () => { jar = { 'next-admin-auth.session-token': await token({ name: 'Root', role: 'superadmin', email: 'r@x.y' }) } }

const b64 = (s: string | number[]) => Buffer.from(s as never).toString('base64')
const PNG = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])}`
const PDF = `data:application/pdf;base64,${b64('%PDF-1.7\n')}`
const SVG = `data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"/>')}`
const HTML = `data:text/html;base64,${b64('<script>fetch("/api/admin/agents")</script>')}`

async function upload(fileName: unknown, fileData: unknown, docType = 'id') {
  const { POST } = await import('../src/app/api/agent/documents/route')
  const res = await POST(new Request('http://localhost/api/agent/documents', { method: 'POST', body: JSON.stringify({ docType, fileName, fileData }) }))
  return { status: res.status, body: await res.json() }
}

async function serve(agentId: string, docType = 'id') {
  const { GET } = await import('../src/app/api/admin/agents/[id]/documents/[docType]/route')
  return GET(new NextRequest(`http://localhost/api/admin/agents/${agentId}/documents/${docType}`), { params: Promise.resolve({ id: agentId, docType }) })
}

const storeRaw = (agentId: string, fileName: string, fileData: string) =>
  prisma.agentDocument.create({ data: { agentId, docType: 'id', fileName, fileData } })

function assertHardened(res: Response) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/)
}

type Authorize = (c: Record<string, string>, req?: unknown) => Promise<{ id: string } | null>
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize
const fromIp = (ip: string) => ({ headers: { 'x-forwarded-for': `9.9.9.9, ${ip}` } })
const freshIp = () => { const ip = `10.${(n++ % 200) + 1}.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`; ipKeys.push(`ip:agent:${ip}`); return ip }

after(async () => {
  await prisma.customerChatMessage.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agentDocumentVersion.deleteMany({ where: { agentId: { in: created } } })
  await prisma.agentDocument.deleteMany({ where: { agentId: { in: created } } })
  await prisma.biometricToken.deleteMany({ where: { agentId: { in: created } } })
  await prisma.agent.deleteMany({ where: { id: { in: created } } })
  await prisma.loginAttempt.deleteMany({ where: { key: { in: ipKeys } } })
  await prisma.$disconnect()
})

// ── Upload ──
for (const [label, data] of [['SVG', SVG], ['HTML', HTML], ['HTML labelled as PNG', `data:image/png;base64,${b64('<script>x</script>')}`]] as const) {
  test(`upload: ${label} is refused with a readable message and not stored`, async () => {
    const a = await mkAgent()
    await asAgent(a)
    const r = await upload('id.png', data)
    assert.equal(r.status, 400)
    assert.match(r.body.error, /JPEG, PNG, WebP or PDF/)
    assert.equal(await prisma.agentDocument.count({ where: { agentId: a.id } }), 0)
  })
}

test('upload: a real image and PDF are stored, with a safe name', async () => {
  const a = await mkAgent()
  await asAgent(a)
  assert.equal((await upload('../../x.png', PNG)).status, 200)
  assert.equal((await prisma.agentDocument.findFirstOrThrow({ where: { agentId: a.id } })).fileName, 'x.png')
  assert.equal((await upload('form.PDF', PDF)).status, 200)
  assert.equal((await prisma.agentDocument.findFirstOrThrow({ where: { agentId: a.id } })).fileName, 'form.pdf')
})

// ── Serve ──
for (const [label, data] of [['SVG', SVG], ['HTML', HTML]] as const) {
  test(`serve: a stored ${label} row goes as a harmless attachment`, async () => {
    const a = await mkAgent()
    await storeRaw(a.id, 'evil.html', data)
    await asAdmin()
    const res = await serve(a.id)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/octet-stream')
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment/)
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/)
    assertHardened(res)
  })
}

test('serve: a good PDF and image open inline for the admin, hardened', async () => {
  for (const [data, type] of [[PNG, 'image/png'], [PDF, 'application/pdf']] as const) {
    const a = await mkAgent()
    await storeRaw(a.id, 'doc', data)
    await asAdmin()
    const res = await serve(a.id)
    assert.equal(res.headers.get('content-type'), type)
    assert.match(res.headers.get('content-disposition') ?? '', /^inline/)
    assertHardened(res)
  }
})

// ── Chat images ──
test('chat: an agent or customer cannot store a script or remote URL as an image', async () => {
  const a = await mkAgent()
  const c = await prisma.customer.create({
    data: { customerId: `SEC-C-${rid}`, agentId: a.id, firstName: 'C', lastName: 'X', phone: `0791${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  await asAgent(a)
  const agentChat = await import('../src/app/api/agent/customer-chat/route')
  const send = (imageUrl: string) => agentChat.POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ customerId: c.id, message: 'hi', imageUrl }) }))
  for (const bad of ['javascript:alert(1)', HTML, 'https://evil.test/a.png']) assert.equal((await send(bad)).status, 400, bad.slice(0, 20))
  assert.equal((await send(PNG)).status, 200)

  const { signCustomerToken } = await import('../src/lib/customer-auth')
  jar = { customer_token: await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId: a.id }) }
  const customerChat = await import('../src/app/api/customer/chat/route')
  const cSend = (imageUrl: string) => customerChat.POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ message: 'hi', imageUrl }) }))
  assert.equal((await cSend('javascript:alert(1)')).status, 400)
  assert.equal((await cSend(PNG)).status, 200)
  assert.equal(await prisma.customerChatMessage.count({ where: { customerId: c.id } }), 2)
})

// ── Login bypass ──
test('bypass: a biometric token with no device never reads the password, even the right one', async () => {
  const a = await mkAgent()
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD, biometricToken: 'x', deviceId: '' }), null)
})

test('bypass: wrong password guesses through the biometric path no longer work, and a plain guess still counts', async () => {
  const a = await mkAgent()
  for (let i = 0; i < 5; i++) assert.equal(await authorize({ identifier: a.agentId, password: 'guess', biometricToken: 'x', deviceId: '' }), null)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).lockedAt, null, 'a fingerprint failure must not lock the account')
  await authorize({ identifier: a.agentId, password: 'guess' })
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).loginAttempts, 1)
})

test('a real fingerprint still signs in; a wrong one does not lock the account', async () => {
  const a = await mkAgent()
  const raw = `bio-${rid}-${n}`
  const deviceId = `dev-${rid}-${n}`
  await prisma.biometricToken.create({ data: { agentId: a.id, deviceId, tokenHash: createHash('sha256').update(raw).digest('hex') } })
  assert.equal((await authorize({ identifier: a.agentId, biometricToken: raw, deviceId }))?.id, a.id)
  for (let i = 0; i < 5; i++) assert.equal(await authorize({ identifier: a.agentId, biometricToken: 'wrong', deviceId }), null)
  const row = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(row.lockedAt, null)
  assert.equal((await authorize({ identifier: a.agentId, biometricToken: raw, deviceId }))?.id, a.id)
})

test('a stolen fingerprint token with a Prisma filter for its device is refused', async () => {
  const a = await mkAgent()
  const raw = `bio-${rid}-filter-${n}`
  await prisma.biometricToken.create({ data: { agentId: a.id, deviceId: `dev-${rid}-filter-${n}`, tokenHash: createHash('sha256').update(raw).digest('hex') } })
  const creds = (extra: unknown) => ({ identifier: a.agentId, biometricToken: raw, ...(extra as object) }) as Record<string, string>
  for (const deviceId of [{ not: '' }, { contains: 'dev' }, ['x'], 42, true]) {
    assert.equal(await authorize(creds({ deviceId })), null, JSON.stringify(deviceId))
  }
})

test('non-string credentials are refused, not passed on or crashed on', async () => {
  const a = await mkAgent()
  const bad = (c: unknown) => authorize(c as Record<string, string>)
  assert.equal(await bad({ identifier: { contains: 'SEC' }, password: PASSWORD }), null)
  assert.equal(await bad({ identifier: a.agentId, password: { not: '' } }), null)
  assert.equal(await bad({ identifier: a.agentId, biometricToken: { not: '' }, deviceId: 'x' }), null)
  assert.equal(await bad({ identifier: 42, password: 'x' }), null)
  // A non-string extra field must not skip the app's device binding, or change the result of a good sign-in.
  assert.equal((await bad({ identifier: a.agentId, password: PASSWORD, app: { x: 1 } }))?.id, a.id)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).boundDeviceId, null)
})

test('a device-bound agent in the app stays bound: another device is refused', async () => {
  const a = await mkAgent({ boundDeviceId: `bound-${rid}-${n}` })
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD, app: 'agent', deviceId: 'other' }), null)
})

test('a normal password sign-in still works', async () => {
  const a = await mkAgent()
  assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }, fromIp(freshIp())))?.id, a.id)
})

// ── IP throttle ──
test('IP throttle: failures from one address are counted in the database and then block, across accounts', async () => {
  const ip = freshIp()
  const a = await mkAgent()
  for (let i = 0; i < 20; i++) await authorize({ identifier: `SEC-${rid}-NOBODY-${i}`, password: 'x' }, fromIp(ip))
  const row = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `ip:agent:${ip}` } })
  assert.equal(row.failCount, 20)
  assert.ok(row.lockedUntil && row.lockedUntil.getTime() > Date.now())
  // The right password from that address is refused while it's blocked, and doesn't count against the account.
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }, fromIp(ip)), null)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).loginAttempts, 0)
  // Another address is unaffected.
  assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }, fromIp(freshIp())))?.id, a.id)
})

test('IP throttle: fingerprint failures are not counted, and a valid fingerprint gets through a blocked address', async () => {
  const ip = freshIp()
  const a = await mkAgent()
  const raw = `bio-${rid}-ipblock-${n}`
  const deviceId = `dev-${rid}-ipblock-${n}`
  await prisma.biometricToken.create({ data: { agentId: a.id, deviceId, tokenHash: createHash('sha256').update(raw).digest('hex') } })
  for (let i = 0; i < 25; i++) assert.equal(await authorize({ identifier: a.agentId, biometricToken: 'wrong', deviceId }, fromIp(ip)), null)
  assert.equal(await prisma.loginAttempt.count({ where: { key: `ip:agent:${ip}` } }), 0)
  for (let i = 0; i < 20; i++) await authorize({ identifier: `SEC-${rid}-NOBODY-${i}`, password: 'x' }, fromIp(ip))
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }, fromIp(ip)), null, 'a password is refused from the blocked address')
  assert.equal((await authorize({ identifier: a.agentId, biometricToken: raw, deviceId }, fromIp(ip)))?.id, a.id)
})

test('account lock: a parallel burst gets exactly 3 password checks, and ends in a real lock', async () => {
  const a = await mkAgent()
  const spy = bcrypt as unknown as { compare: typeof bcrypt.compare }
  const real = spy.compare
  let checks = 0
  spy.compare = ((...args: Parameters<typeof bcrypt.compare>) => { checks++; return real(...args) }) as typeof bcrypt.compare
  try {
    await Promise.all(Array.from({ length: 30 }, () => authorize({ identifier: a.agentId, password: 'guess' }, fromIp(freshIp()))))
  } finally {
    spy.compare = real
  }
  assert.equal(checks, 3)
  const row = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(row.loginAttempts, 3)
  assert.ok(row.lockedAt)
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }), null, 'locked, even with the right password')
})

test('account lock: an old lock does not expire by itself, so a burst still gets no password checks', async () => {
  const a = await mkAgent({ loginAttempts: 3, lockedAt: new Date(Date.now() - 31 * 60_000) })
  const spy = bcrypt as unknown as { compare: typeof bcrypt.compare }
  const real = spy.compare
  let checks = 0
  spy.compare = ((...args: Parameters<typeof bcrypt.compare>) => { checks++; return real(...args) }) as typeof bcrypt.compare
  try {
    await Promise.all(Array.from({ length: 10 }, () => authorize({ identifier: a.agentId, password: 'guess' }, fromIp(freshIp()))))
  } finally {
    spy.compare = real
  }
  assert.equal(checks, 0)
  assert.ok((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).lockedAt)
})

test('account lock: resets on success, including a success on the third try', async () => {
  const a = await mkAgent()
  await authorize({ identifier: a.agentId, password: 'guess' })
  await authorize({ identifier: a.agentId, password: 'guess' })
  assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }))?.id, a.id)
  const row = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(row.loginAttempts, 0)
  assert.equal(row.lockedAt, null)
})

test('account lock: stays locked after 30 minutes, even with the right password, until a code unlocks it', async () => {
  const a = await mkAgent({ loginAttempts: 3, lockedAt: new Date(Date.now() - 31 * 60_000) })
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }), null)
  assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }), null)
  assert.ok((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).lockedAt)
})

test('account lock: the wrong password that locks the account ends sessions already open, once', async () => {
  const a = await mkAgent()
  await authorize({ identifier: a.agentId, password: 'guess' })
  await authorize({ identifier: a.agentId, password: 'guess' })
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).tokenVersion, a.tokenVersion)
  await authorize({ identifier: a.agentId, password: 'guess' }) // third: locks
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).tokenVersion, a.tokenVersion + 1)
  await authorize({ identifier: a.agentId, password: 'guess' }) // refused, no further bump
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).tokenVersion, a.tokenVersion + 1)
})

test('account lock: a right password on the third try keeps the owner signed in on their other devices', async () => {
  const a = await mkAgent()
  await authorize({ identifier: a.agentId, password: 'guess' })
  await authorize({ identifier: a.agentId, password: 'guess' })
  assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }))?.id, a.id)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).tokenVersion, a.tokenVersion)
})

test('check-agent: a lock older than 30 minutes is still reported as locked', async () => {
  const a = await mkAgent({ loginAttempts: 3, lockedAt: new Date(Date.now() - 31 * 60_000) })
  const { POST } = await import('../src/app/api/auth/check-agent/route')
  const res = await POST(new Request('http://localhost/api/auth/check-agent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ identifier: a.agentId }) }) as never)
  assert.equal((await res.json()).locked, true)
})

test('a right password for a suspended agent is refused but does not build toward a lock', async () => {
  const a = await mkAgent({ status: 'Suspended' })
  for (let i = 0; i < 4; i++) assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }), null)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).lockedAt, null)
})

test('signing in does not count against the address', async () => {
  const ip = freshIp()
  const a = await mkAgent()
  for (let i = 0; i < 25; i++) assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }, fromIp(ip)))?.id, a.id)
})

test('if an attempt cannot be counted it is refused, and that is logged', async () => {
  const a = await mkAgent()
  const realQuery = prisma.$queryRaw
  const db = prisma as unknown as { $queryRaw: unknown }
  const logged: unknown[][] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  db.$queryRaw = () => Promise.reject(new Error('database is locked'))
  try {
    assert.equal(await authorize({ identifier: a.agentId, password: PASSWORD }), null)
  } finally {
    db.$queryRaw = realQuery
    console.error = realError
  }
  assert.ok(logged.some(args => String(args[0]).includes('agent-login')))
  assert.equal((await authorize({ identifier: a.agentId, password: PASSWORD }))?.id, a.id, 'and recovers')
})

test('IP throttle: only the proxy-appended address counts, so a forged header cannot evade it', async () => {
  const ip = freshIp()
  await authorize({ identifier: `SEC-${rid}-NOBODY`, password: 'x' }, { headers: { 'x-forwarded-for': `1.1.1.1, ${ip}` } })
  await authorize({ identifier: `SEC-${rid}-NOBODY`, password: 'x' }, { headers: { 'x-forwarded-for': `2.2.2.2, ${ip}` } })
  assert.equal((await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `ip:agent:${ip}` } })).failCount, 2)
})

// ── Lookup rate limits ──
const postJson = (url: string, body: unknown, ip: string) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } })

test('check-agent: keeps working for the login screen, then returns 429', async () => {
  const a = await mkAgent({ status: 'Suspended' })
  const { POST } = await import('../src/app/api/auth/check-agent/route')
  const ip = `11.0.0.${(n % 200) + 1}`
  const first = await POST(postJson('http://localhost/x', { identifier: a.agentId }, ip))
  assert.equal(first.status, 200)
  assert.equal((await first.json()).status, 'Suspended')
  let last = first
  for (let i = 0; i < 40; i++) last = await POST(postJson('http://localhost/x', { identifier: a.agentId }, ip))
  assert.equal(last.status, 429)
  assert.equal((await POST(postJson('http://localhost/x', { identifier: a.agentId }, `12.0.0.${(n % 200) + 1}`))).status, 200, 'another address is unaffected')
})

test('check-agent: reports when this address is blocked, so the screen can say so', async () => {
  const ip = freshIp()
  for (let i = 0; i < 20; i++) await authorize({ identifier: `SEC-${rid}-NOBODY-${i}`, password: 'x' }, fromIp(ip))
  const { POST } = await import('../src/app/api/auth/check-agent/route')
  const body = await (await POST(postJson('http://localhost/x', { identifier: `SEC-${rid}-NOBODY` }, ip))).json()
  assert.ok(body.throttledSeconds > 0)
})

test('check-agent: a non-string identifier reports no account, not a 500', async () => {
  const { POST } = await import('../src/app/api/auth/check-agent/route')
  assert.equal((await POST(postJson('http://localhost/x', { identifier: 42 }, `13.0.0.${(n % 200) + 1}`))).status, 200)
})
