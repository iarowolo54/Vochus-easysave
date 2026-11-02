// Two public holes: POST /api/wallet credited any amount with no payment, and /api/identity/bvn gave
// anyone's identity to anyone, on Vochus's Paystack account. Rows are scoped by a run id. Paystack is
// stubbed; a non-test key is used so a lookup really reaches the stub and can be counted.
process.env.PAYSTACK_SECRET_KEY = 'sk_live_stubbed_never_sent'
process.env.NEXTAUTH_SECRET ??= 'test-secret-wallet-bvn'
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
let lookups = 0
let paystackFails = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (!u.includes('/bank/resolve_bvn/')) throw new Error(`unexpected network call: ${u}`)
  lookups++
  if (paystackFails) return new Response(JSON.stringify({ status: false, message: 'Stranger failed' }), { status: 400 })
  return new Response(JSON.stringify({ status: true, data: {
    bvn: '22222222222', first_name: 'Stranger', last_name: 'Person', middle_name: 'Secret', formatted_dob: '1980-02-03', mobile: '08000000000', gender: 'Female',
  } }), { status: 200 })
}) as typeof fetch
/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/lib/prisma') as typeof import('../src/lib/prisma')
const wallet = require('../src/app/api/wallet/route') as typeof import('../src/app/api/wallet/route')
const bvnRoute = require('../src/app/api/identity/bvn/route') as typeof import('../src/app/api/identity/bvn/route')
const enroll = require('../src/app/api/customer/enroll/route') as typeof import('../src/app/api/customer/enroll/route')
const { BVN_LOOKUPS_PER_EMAIL_PER_HOUR, BVN_LOOKUPS_PER_IP_PER_HOUR, bvnNameMatches, spendIpLookup } = require('../src/lib/bvn-lookup') as typeof import('../src/lib/bvn-lookup')
/* eslint-enable @typescript-eslint/no-require-imports */

const RUN = Math.random().toString(36).slice(2, 8)
const BVN = '22222222222'
const MATCHING = { firstName: 'Stranger', lastName: 'Person' }
const IDENTITY = /Stranger|Person|Secret|1980|08000000000|Female/
let agentId = ''
let agentCode = ''
const emails: string[] = []
const ipKeys: string[] = []
let ipSeq = 0
const consoleLines: string[] = []
const realLog = { log: console.log, error: console.error, warn: console.warn }

const freshIp = () => {
  const ip = `198.51.${Number.parseInt(RUN.slice(0, 2), 36) % 255}.${ipSeq++ % 250}-${RUN}-${ipSeq}`
  ipKeys.push(`bvn-lookup:ip:${ip}`)
  return ip
}
const lookup = (body: unknown, ip = freshIp()) => bvnRoute.POST({
  json: async () => body, headers: new Headers({ 'x-forwarded-for': ip }),
} as never)
const emailSpent = async (email: string) => (await prisma.loginAttempt.findUnique({ where: { key: `bvn-lookup:email:${email}` } }))?.failCount ?? 0
async function verifiedEmail(over: { createdAt?: Date; verified?: boolean; attempts?: number } = {}) {
  const email = `wb-${RUN}-${emails.length}@test.local`
  emails.push(email)
  ipKeys.push(`bvn-lookup:email:${email}`)
  await prisma.emailOTP.create({ data: { email, code: '123456', expiresAt: new Date(Date.now() + 6e5), verified: over.verified ?? true, attempts: over.attempts ?? 1, createdAt: over.createdAt ?? new Date() } })
  return email
}
const enrolBody = (email: string, over: Record<string, unknown> = {}) => ({
  aid: agentCode, firstName: 'Ada', lastName: 'Obi', phone: `080${String(emails.length).padStart(2, '0')}${RUN}`.padEnd(11, '1').slice(0, 11).replace(/\D/g, '1'), email,
  dob: '1990-01-01', address: '12 Long Street, Ikeja', gender: 'Female', state: 'Lagos', lga: 'Ikeja',
  nokName: 'N', nokRelation: 'Sister', nokPhone: '08099999999', password: 'secret123', dailyAmount: 500, periodDays: 90, goal: 'x',
  bvn: BVN, ...over,
})
const enrolPost = (body: unknown, ip = freshIp()) => enroll.POST({ json: async () => body, headers: new Headers({ 'x-forwarded-for': ip }) } as never)

before(async () => {
  agentCode = `WB-${RUN}`
  agentId = (await prisma.agent.create({ data: { agentId: agentCode, phone: `0795${RUN}`, name: 'Wallet Agent', location: 'x', password: 'x', walletBalance: 500 } })).id
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { consoleLines.push(a.map(String).join(' ')) }
})

beforeEach(() => { lookups = 0 })

after(async () => {
  Object.assign(console, realLog)
  M._load = realLoad
  globalThis.fetch = realFetch
  await prisma.emailOTP.deleteMany({ where: { email: { in: emails } } })
  await prisma.loginAttempt.deleteMany({ where: { key: { in: ipKeys } } })
  await prisma.savingsPlan.deleteMany({ where: { customer: { agentId } } })
  await prisma.customer.deleteMany({ where: { agentId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

// ---------- wallet ----------
test('the wallet route has no POST, so it cannot credit anything', () => {
  assert.equal((wallet as Record<string, unknown>).POST, undefined)
})

test('wallet GET still returns the balance', async () => {
  stub.getServerSession = async () => ({ user: { agentId: agentCode } })
  const res = await wallet.GET()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).balance, 500)
  stub.getServerSession = async () => null
  assert.equal((await wallet.GET()).status, 401)
})

// ---------- /api/identity/bvn ----------
test('no verified email: refused, and Paystack is never called', async () => {
  const unverified = await verifiedEmail({ verified: false })
  const stale = await verifiedEmail({ createdAt: new Date(Date.now() - 31 * 60_000) })
  for (const body of [{ bvn: BVN, ...MATCHING }, { bvn: BVN, email: 'nobody@test.local', ...MATCHING }, { bvn: BVN, email: unverified, ...MATCHING }, { bvn: BVN, email: stale, ...MATCHING }, { bvn: BVN, email: 123, ...MATCHING }]) {
    const res = await lookup(body)
    assert.equal(res.status, 403, JSON.stringify(body))
    const data = await res.json()
    assert.equal(data.ok, false)
    assert.ok(!IDENTITY.test(JSON.stringify(data)))
  }
  assert.equal(lookups, 0)
})

test('a verified email only learns whether the typed name matches', async () => {
  const email = await verifiedEmail()
  const yes = await lookup({ bvn: BVN, email: email.toUpperCase(), ...MATCHING })
  assert.equal(yes.status, 200)
  assert.deepEqual(await yes.json(), { ok: true, match: true })
  const no = await lookup({ bvn: BVN, email, firstName: 'Ada', lastName: 'Obi' })
  assert.equal(no.status, 200)
  assert.deepEqual(await no.json(), { ok: true, match: false })
  assert.equal(lookups, 2)
})

test('the name comparison ignores case and spaces, and nothing else', async () => {
  const email = await verifiedEmail()
  const check = async (firstName: string, lastName: string) => (await (await lookup({ bvn: BVN, email, firstName, lastName })).json()).match
  assert.equal(await check('  sTRANGER ', 'person  '), true)
  assert.equal(await check('Stranger Secret', 'Person'), false, 'middle name in the first name box')
  assert.equal(await check('Person', 'Stranger'), false, 'swapped')
  assert.equal(await check('Stranger', '  Person '), true)
})

test('bvnNameMatches: inner spaces and a phone keyboard apostrophe still match', () => {
  const resolved = { firstName: "Mary  Ann", lastName: "O'Neil" }
  assert.equal(bvnNameMatches(resolved, { firstName: 'mary ann', lastName: 'O’Neil' }), true)
  assert.equal(bvnNameMatches(resolved, { firstName: 'Mary', lastName: "O'Neil" }), false)
  assert.equal(bvnNameMatches(resolved, { firstName: 'mary ann', lastName: 'ONeil' }), false)
})

test('a failed check logs only the error class and status, so a wrong key gets noticed', async () => {
  const email = await verifiedEmail()
  const before = consoleLines.length
  paystackFails = true
  try { await lookup({ bvn: BVN, email, ...MATCHING }) } finally { paystackFails = false }
  assert.deepEqual(consoleLines.slice(before), ['[bvn] check failed BvnLookupFailed 400'])
})

test('no response carries an identity field, including when Paystack fails', async () => {
  const email = await verifiedEmail()
  const ok = JSON.stringify(await (await lookup({ bvn: BVN, email, firstName: 'Ada', lastName: 'Obi' })).json())
  assert.ok(!IDENTITY.test(ok), ok)
  paystackFails = true
  try {
    const res = await lookup({ bvn: BVN, email, ...MATCHING })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.ok(!IDENTITY.test(JSON.stringify(body)), JSON.stringify(body))
    assert.doesNotMatch(body.error, /Stranger failed/)
  } finally { paystackFails = false }
})

test('a name is required, before anything is spent', async () => {
  const email = await verifiedEmail()
  for (const names of [{}, { firstName: 'Ada' }, { firstName: ' ', lastName: 'Obi' }, { firstName: 1, lastName: 2 }]) {
    assert.equal((await lookup({ bvn: BVN, email, ...names })).status, 400)
  }
  assert.equal(await emailSpent(email), 0)
  assert.equal(lookups, 0)
})

test('bad BVN format is refused without spending anything', async () => {
  const email = await verifiedEmail()
  assert.equal((await lookup({ bvn: '123', email, ...MATCHING })).status, 400)
  assert.equal(await emailSpent(email), 0)
  assert.equal(lookups, 0)
})

test('one email is capped, and a new code does not reset it', async () => {
  const email = await verifiedEmail()
  for (let i = 0; i < BVN_LOOKUPS_PER_EMAIL_PER_HOUR; i++) assert.equal((await lookup({ bvn: BVN, email, ...MATCHING })).status, 200, `lookup ${i}`)
  const res = await lookup({ bvn: BVN, email, ...MATCHING })
  assert.equal(res.status, 429)
  assert.equal((await res.json()).ok, false)
  // What email-otp does on a resend: the old row goes, a new verified row replaces it.
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.emailOTP.create({ data: { email, code: '654321', expiresAt: new Date(Date.now() + 6e5), verified: true } })
  assert.equal((await lookup({ bvn: BVN, email, ...MATCHING })).status, 429)
  assert.equal(lookups, BVN_LOOKUPS_PER_EMAIL_PER_HOUR)
})

test('one IP is capped across many verified emails', async () => {
  const ip = freshIp()
  const email = await verifiedEmail()
  // Spend the rest of the hour's budget directly, then the route must refuse before Paystack.
  for (let i = 0; i < BVN_LOOKUPS_PER_IP_PER_HOUR; i++) assert.equal(await spendIpLookup(ip), true)
  const res = await lookup({ bvn: BVN, email, ...MATCHING }, ip)
  assert.equal(res.status, 429)
  assert.equal(lookups, 0)
})

test('the IP budget is shared state: concurrent spends never exceed it', async () => {
  const ip = freshIp()
  const results = await Promise.all(Array.from({ length: BVN_LOOKUPS_PER_IP_PER_HOUR + 8 }, () => spendIpLookup(ip)))
  assert.equal(results.filter(Boolean).length, BVN_LOOKUPS_PER_IP_PER_HOUR)
  const row = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `bvn-lookup:ip:${ip}` } })
  assert.equal(row.failCount, BVN_LOOKUPS_PER_IP_PER_HOUR)
})

test('the IP budget opens again after the hour, and survives the login sweep until then', async () => {
  const ip = freshIp()
  const t0 = new Date('2026-11-02T10:00:00.000Z')
  for (let i = 0; i < BVN_LOOKUPS_PER_IP_PER_HOUR; i++) await spendIpLookup(ip, t0)
  assert.equal(await spendIpLookup(ip, new Date(t0.getTime() + 59 * 60_000)), false)
  assert.equal(await spendIpLookup(ip, new Date(t0.getTime() + 61 * 60_000)), true)
  const { sweepStaleLoginAttempts } = require('../src/lib/login-attempt') as typeof import('../src/lib/login-attempt') // eslint-disable-line @typescript-eslint/no-require-imports
  const liveIp = freshIp()
  await spendIpLookup(liveIp)
  await sweepStaleLoginAttempts(Date.now() + 40 * 60_000)
  assert.ok(await prisma.loginAttempt.findUnique({ where: { key: `bvn-lookup:ip:${liveIp}` } }), 'a live window is not swept')
})

// ---------- the same lookup through enrolment ----------
test('enrol cannot be used as a way round the gate: no verified email, no lookup and no name', async () => {
  const res = await enrolPost(enrolBody('nobody@test.local', { firstName: 'Wrong', lastName: 'Name' }))
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'Confirm your email first')
  assert.equal(lookups, 0)
})

test('enrol with a verified email still checks the BVN name, and spends the same budget', async () => {
  const email = await verifiedEmail()
  const res = await enrolPost(enrolBody(email, { firstName: 'Wrong', lastName: 'Name' }))
  assert.equal(res.status, 400)
  const { error } = await res.json()
  assert.match(error, /doesn’t match the name you entered/)
  assert.ok(!IDENTITY.test(error), error)
  assert.equal(lookups, 1)
  assert.equal(await emailSpent(email), 1)
})

test('enrol does not pass on Paystack\'s error text', async () => {
  const email = await verifiedEmail()
  paystackFails = true
  try {
    const res = await enrolPost(enrolBody(email))
    assert.equal(res.status, 400)
    const { error } = await res.json()
    assert.ok(!IDENTITY.test(error), error)
  } finally { paystackFails = false }
})

test('out of BVN checks at the last step: a clear way out, no account with an unchecked BVN, and no BVN still works', async () => {
  const email = await verifiedEmail()
  for (let i = 0; i < BVN_LOOKUPS_PER_EMAIL_PER_HOUR; i++) assert.equal((await lookup({ bvn: BVN, email, ...MATCHING })).status, 200)
  lookups = 0
  const body = enrolBody(email, MATCHING)
  const res = await enrolPost(body)
  assert.equal(res.status, 429)
  const refused = await res.json()
  assert.equal(refused.code, 'bvn_budget')
  assert.match(refused.error, /[Rr]emove the BVN/)
  assert.equal(lookups, 0, 'no paid lookup')
  assert.equal(await prisma.customer.count({ where: { email } }), 0, 'a BVN is never stored unchecked')
  const without = await enrolPost({ ...body, bvn: '' })
  assert.equal(without.status, 200, JSON.stringify(await without.clone().json()))
  assert.equal((await prisma.customer.findFirstOrThrow({ where: { email } })).bvn, null)
})

test('the page can tell a BVN budget refusal from any other enrol limit', async () => {
  const email = await verifiedEmail()
  for (let i = 0; i < BVN_LOOKUPS_PER_EMAIL_PER_HOUR; i++) await lookup({ bvn: BVN, email, ...MATCHING })
  const res = await lookup({ bvn: BVN, email, ...MATCHING })
  assert.equal(res.status, 429)
  assert.equal((await res.json()).code, 'bvn_budget')
})

test('an IP that is out of checks does not use up the email budget', async () => {
  const ip = freshIp()
  const email = await verifiedEmail()
  for (let i = 0; i < BVN_LOOKUPS_PER_IP_PER_HOUR; i++) await spendIpLookup(ip)
  assert.equal((await lookup({ bvn: BVN, email, ...MATCHING }, ip)).status, 429)
  assert.equal(await emailSpent(email), 0)
})

test('enrol with no BVN needs no lookup and spends nothing', async () => {
  const email = await verifiedEmail()
  const res = await enrolPost(enrolBody(email, { bvn: '' }))
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  assert.equal(lookups, 0)
})

test('enrol with a matching BVN completes', async () => {
  const email = await verifiedEmail()
  const res = await enrolPost(enrolBody(email, { firstName: ' stranger ', lastName: 'PERSON' }))
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  assert.equal(lookups, 1)
})

test('neither the BVN nor the resolved name is ever logged', () => {
  const leaked = consoleLines.find(l => l.includes(BVN) || IDENTITY.test(l))
  assert.equal(leaked, undefined, leaked)
})
