// Integration tests: suspending an agent ends their access on the next request, with no way back in
// through an old session or a stored fingerprint token. Customers of that agent are not affected.
//   NEXTAUTH_SECRET=test npx tsx --test tests/agent-suspend.int.test.ts
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { encode } from 'next-auth/jwt'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { authOptions } from '../src/lib/auth'

const rid = Math.random().toString(36).slice(2, 8).toUpperCase()
const created: string[] = []
const customerIds: string[] = []
const docAgentIds: string[] = []
let n = 0

// getServerSession reads these; each test sets the cookies it's sending.
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

async function mkAgent(status = 'Active') {
  n++
  const a = await prisma.agent.create({
    data: { agentId: `SUS-${rid}-${n}`, phone: `0792${rid}${n}`, name: 'Sus', location: 'x', password: 'x', requiredDocs: '[]', status },
  })
  created.push(a.id)
  return a
}

const sessionCb = authOptions.callbacks!.session! as unknown as (a: { session: unknown; token: unknown }) => Promise<{ user?: { id?: string } }>
const callSession = (token: Record<string, unknown>) =>
  sessionCb({ session: { user: { name: 'Sus' }, expires: '' }, token })

/** The cookie an agent got at login, carrying the tokenVersion stamped at that moment. */
function agentCookie(a: { agentId: string; name: string }, tokenVersion: number) {
  return encode({
    token: { name: a.name, sub: 'x', agentId: a.agentId, tokenVersion, loginAt: Math.floor(Date.now() / 1000) },
    secret: process.env.NEXTAUTH_SECRET as string,
  })
}

function adminCookie() {
  return encode({
    token: { name: 'Root', sub: 'root', role: 'superadmin', email: 'root@x.y', loginAt: Math.floor(Date.now() / 1000) },
    secret: process.env.NEXTAUTH_SECRET as string,
  })
}

async function setStatus(id: string, status: string, cookie?: string) {
  jar = { 'next-admin-auth.session-token': cookie ?? await adminCookie() }
  const { PATCH } = await import('../src/app/api/admin/agents/[id]/status/route')
  const res = await PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status }) }), { params: Promise.resolve({ id }) })
  return res.status
}

type Authorize = (c: Record<string, string>) => Promise<{ id: string } | null>
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize

async function fingerprintToken(agentId: string) {
  const token = `bio-${rid}-${++n}`
  const deviceId = `dev-${rid}-${n}`
  await prisma.biometricToken.create({ data: { agentId, deviceId, tokenHash: createHash('sha256').update(token).digest('hex') } })
  return { token, deviceId }
}

async function callIssue(a: { agentId: string; name: string }, tokenVersion: number, deviceId: string) {
  jar = { 'next-auth.session-token': await agentCookie(a, tokenVersion) }
  const { POST } = await import('../src/app/api/auth/biometric/issue/route')
  return POST(new NextRequest('http://localhost/api/auth/biometric/issue', { method: 'POST', body: JSON.stringify({ deviceId }) }))
}

before(async () => {
  // An Active agent must exist, so a lookup with no agentId has something to wrongly return.
  await mkAgent()
})

after(async () => {
  await prisma.agentDocument.deleteMany({ where: { agentId: { in: docAgentIds } } })
  await prisma.biometricToken.deleteMany({ where: { agentId: { in: created } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: { in: created } } })
  await prisma.$disconnect()
})

test('an Active agent keeps their session', async () => {
  const a = await mkAgent()
  const s = await callSession({ agentId: a.agentId, tokenVersion: 0 })
  assert.equal(s.user?.id, a.id)
})

for (const status of ['Suspended', 'PendingActivation']) {
  test(`a ${status} agent's session is cleared`, async () => {
    const a = await mkAgent(status)
    assert.equal((await callSession({ agentId: a.agentId, tokenVersion: 0 })).user, undefined)
  })
}

test('an agent whose row is gone has their session cleared', async () => {
  assert.equal((await callSession({ agentId: `SUS-${rid}-GONE`, tokenVersion: 0 })).user, undefined)
})

for (const [label, agentId] of [['missing', undefined], ['empty', ''], ['non-string', 42], ['null', null]] as const) {
  test(`a token with a ${label} agentId is cleared, and never resolves to some other agent`, async () => {
    assert.equal((await callSession({ agentId, tokenVersion: 0 })).user, undefined)
  })
}

test('suspending ends the session already in use, on its next request', async () => {
  const a = await mkAgent()
  assert.ok((await callSession({ agentId: a.agentId, tokenVersion: 0 })).user)
  assert.equal(await setStatus(a.id, 'Suspended'), 200)
  assert.equal((await callSession({ agentId: a.agentId, tokenVersion: 0 })).user, undefined)
})

test('suspending bumps tokenVersion; reinstating does not, so the old session stays dead', async () => {
  const a = await mkAgent()
  await setStatus(a.id, 'Suspended')
  const suspended = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(suspended.tokenVersion, 1)
  await setStatus(a.id, 'Active')
  const back = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(back.status, 'Active')
  assert.equal(back.tokenVersion, 1)
  assert.equal((await callSession({ agentId: a.agentId, tokenVersion: 0 })).user, undefined, 'pre-suspension session')
  assert.equal((await callSession({ agentId: a.agentId, tokenVersion: 1 })).user?.id, a.id, 'a fresh login')
})

test('the status route returns only the id and status, never the password hash or other agent data', async () => {
  const a = await mkAgent()
  await prisma.agent.update({ where: { id: a.id }, data: { password: '$2a$10$secrethash', bvn: '22222222222' } })
  jar = { 'next-admin-auth.session-token': await adminCookie() }
  const { PATCH } = await import('../src/app/api/admin/agents/[id]/status/route')
  const res = await PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status: 'Suspended' }) }), { params: Promise.resolve({ id: a.id }) })
  const text = await res.text()
  assert.deepEqual(JSON.parse(text), { agent: { id: a.id, status: 'Suspended' } })
  assert.ok(!text.includes('secrethash'))
})

test('the status route is still super-admin only', async () => {
  const a = await mkAgent()
  const status = await setStatus(a.id, 'Suspended', await agentCookie(a, 0))
  assert.ok(status === 401 || status === 403, `got ${status}`)
  const row = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })
  assert.equal(row.status, 'Active')
  assert.equal(row.tokenVersion, 0)
})

test('fingerprint sign-in: works while Active, refused once suspended', async () => {
  const a = await mkAgent()
  const { token, deviceId } = await fingerprintToken(a.id)
  const creds = { identifier: a.agentId, biometricToken: token, deviceId }
  assert.equal((await authorize(creds))?.id, a.id)
  await prisma.agent.update({ where: { id: a.id }, data: { status: 'Suspended' } })
  assert.equal(await authorize(creds), null)
})

test('suspending revokes stored fingerprint tokens, so reinstating does not revive them', async () => {
  const a = await mkAgent()
  const { token, deviceId } = await fingerprintToken(a.id)
  const creds = { identifier: a.agentId, biometricToken: token, deviceId }
  assert.equal(await setStatus(a.id, 'Suspended'), 200)
  assert.ok((await prisma.biometricToken.findFirstOrThrow({ where: { agentId: a.id, deviceId } })).revokedAt)
  assert.equal(await setStatus(a.id, 'Active'), 200)
  assert.equal(await authorize(creds), null)
})

test('reinstating does not touch fingerprint tokens issued since', async () => {
  const a = await mkAgent()
  await setStatus(a.id, 'Suspended')
  await setStatus(a.id, 'Active')
  const { token, deviceId } = await fingerprintToken(a.id)
  await setStatus(a.id, 'Active')
  assert.equal((await authorize({ identifier: a.agentId, biometricToken: token, deviceId }))?.id, a.id)
})

test('fingerprint issue: Active agent gets a token; a suspended session gets 401 and no token', async () => {
  const a = await mkAgent()
  const ok = await callIssue(a, 0, `dev-${rid}-ok`)
  assert.equal(ok.status, 200)
  await setStatus(a.id, 'Suspended')
  const count = await prisma.biometricToken.count({ where: { agentId: a.id } })
  const refused = await callIssue(a, 0, `dev-${rid}-no`)
  assert.equal(refused.status, 401)
  assert.equal(await prisma.biometricToken.count({ where: { agentId: a.id } }), count)
})

test('a route guarded by session.user refuses a suspended agent', async () => {
  const a = await mkAgent()
  await prisma.agent.update({ where: { id: a.id }, data: { status: 'Suspended' } })
  jar = { 'next-auth.session-token': await agentCookie(a, 0) }
  const { GET } = await import('../src/app/api/agent/customer-chat/route')
  const res = await (GET as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/agent/customer-chat'))
  assert.equal(res.status, 401)
})

test('a customer of a suspended agent keeps their access', async () => {
  const a = await mkAgent()
  const c = await prisma.customer.create({
    data: { customerId: `SUS-C-${rid}`, agentId: a.id, firstName: 'C', lastName: 'X', phone: `0791${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  await setStatus(a.id, 'Suspended')
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  jar = { customer_token: await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId: a.id }) }
  const { GET } = await import('../src/app/api/customer/me/route')
  const res = await GET()
  assert.equal(res.status, 200)
})

async function getDoc(forAgent: string | null, cookies: Record<string, string>) {
  jar = cookies
  const { GET } = await import('../src/app/api/agent/documents/[docType]/route')
  const url = `http://localhost/api/agent/documents/nin${forAgent ? `?agentId=${forAgent}` : ''}`
  return GET(new Request(url), { params: Promise.resolve({ docType: 'nin' }) })
}

async function getStaffDoc(agentId: string, cookies: Record<string, string>) {
  jar = cookies
  const { GET } = await import('../src/app/api/admin/agents/[id]/documents/[docType]/route')
  return GET(new NextRequest(`http://localhost/api/admin/agents/${agentId}/documents/nin`), { params: Promise.resolve({ id: agentId, docType: 'nin' }) })
}

async function mkDoc(agentId: string) {
  await prisma.agentDocument.create({ data: { agentId, docType: 'nin', fileName: 'nin.pdf', fileData: 'data:application/pdf;base64,JVBERg==' } })
  docAgentIds.push(agentId)
}

test("an agent's token in the admin cookie can't read another agent's documents", async () => {
  const [victim, attacker] = [await mkAgent(), await mkAgent()]
  await mkDoc(victim.id)
  const res = await getDoc(victim.id, { 'next-admin-auth.session-token': await agentCookie(attacker, 0) })
  assert.equal(res.status, 401)
})

test("the same token in both cookies still can't read another agent's documents", async () => {
  const [victim, attacker] = [await mkAgent(), await mkAgent()]
  await mkDoc(victim.id)
  const token = await agentCookie(attacker, 0)
  const res = await getDoc(victim.id, { 'next-admin-auth.session-token': token, 'next-auth.session-token': token })
  assert.equal(res.status, 403)
})

test('staff can no longer open documents through the agent route, which has no permission check or audit entry', async () => {
  const a = await mkAgent()
  await mkDoc(a.id)
  assert.equal((await getDoc(a.id, { 'next-admin-auth.session-token': await adminCookie() })).status, 401)
})

test('an agent can read their own documents, and a suspended one cannot', async () => {
  const a = await mkAgent()
  await mkDoc(a.id)
  const cookies = { 'next-auth.session-token': await agentCookie(a, 0) }
  assert.equal((await getDoc(null, cookies)).status, 200)
  assert.equal((await getDoc(a.id, cookies)).status, 200)
  await prisma.agent.update({ where: { id: a.id }, data: { status: 'Suspended' } })
  assert.equal((await getDoc(null, cookies)).status, 401)
})

test('a document with a non-Latin filename still opens for the admin', async () => {
  const a = await mkAgent()
  await prisma.agentDocument.create({ data: { agentId: a.id, docType: 'nin', fileName: 'Àṣàkẹ́.pdf', fileData: 'data:application/pdf;base64,JVBERg==' } })
  docAgentIds.push(a.id)
  const res = await getStaffDoc(a.id, { 'next-admin-auth.session-token': await adminCookie() })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/)
})
