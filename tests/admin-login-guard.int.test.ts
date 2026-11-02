// Integration tests: a super admin password can't be guessed without limit, through either sign-in path.
//   NEXTAUTH_SECRET=test npx tsx --test tests/admin-login-guard.int.test.ts
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { adminAuthOptions } from '../src/lib/auth-admin'
import { ADMIN_ACCOUNT_FAIL_LIMIT, ADMIN_IP_FAIL_LIMIT, adminIpFromForwarded } from '../src/lib/admin-login-guard'
import { POST } from '../src/app/api/admin-auth/login/route'

const rid = Math.random().toString(36).slice(2, 8)
const PASSWORD = 'a-long-test-password'
const emails: string[] = []
const keys: string[] = []
let n = 0

async function mkAdmin() {
  const email = `guard-${rid}-${++n}@test.local`
  emails.push(email)
  keys.push(`admin:${email}`)
  await prisma.superAdmin.create({ data: { email, password: await bcrypt.hash(PASSWORD, 4), name: 'G' } })
  return email
}

const freshIp = () => { const ip = `172.16.${(++n) % 250}.${Math.floor(Math.random() * 250)}`; keys.push(`ip:admin:${ip}`); return ip }
const login = (email: string, password: string, ip = freshIp()) =>
  POST(new NextRequest('http://localhost/api/admin-auth/login', { method: 'POST', body: JSON.stringify({ email, password }), headers: { 'x-forwarded-for': ip } }))

type Authorize = (c: Record<string, string>, req?: unknown) => Promise<{ id: string } | null>
const authorize = (adminAuthOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize
const viaNextAuth = (email: string, password: string, ip = freshIp()) => authorize({ email, password }, { headers: { 'x-forwarded-for': ip } })

after(async () => {
  await prisma.loginAttempt.deleteMany({ where: { key: { in: keys } } })
  await prisma.superAdmin.deleteMany({ where: { email: { in: emails } } })
  await prisma.$disconnect()
})

const failUntilLocked = async (email: string) => {
  for (let i = 0; i < ADMIN_ACCOUNT_FAIL_LIMIT; i++) assert.equal((await login(email, 'wrong')).status, 401)
}

test('the numbers: 5 per account, 10 per address', () => {
  assert.equal(ADMIN_ACCOUNT_FAIL_LIMIT, 5)
  assert.equal(ADMIN_IP_FAIL_LIMIT, 10)
})

test('a correct password signs in, and clears earlier failures', async () => {
  const email = await mkAdmin()
  assert.equal((await login(email, 'wrong')).status, 401)
  const ok = await login(email, PASSWORD)
  assert.equal(ok.status, 200)
  assert.ok(ok.headers.get('set-cookie')?.includes('next-admin-auth.session-token'))
  assert.equal(await prisma.loginAttempt.count({ where: { key: `admin:${email}` } }), 0)
})

test('after the limit, even the right password is refused, from a different address too', async () => {
  const email = await mkAdmin()
  await failUntilLocked(email)
  const res = await login(email, PASSWORD)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('set-cookie'), null)
})

test('the lock is short: once it passes, the right password works', async () => {
  const email = await mkAdmin()
  await failUntilLocked(email)
  const row = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `admin:${email}` } })
  const minutes = (row.lockedUntil!.getTime() - Date.now()) / 60_000
  assert.ok(minutes > 4 && minutes <= 5, `locked for ${minutes} min`)
  await prisma.loginAttempt.update({ where: { key: `admin:${email}` }, data: { lockedUntil: new Date(Date.now() - 1000) } })
  assert.equal((await login(email, PASSWORD)).status, 200)
})

test('tries during a lock do not extend it', async () => {
  const email = await mkAdmin()
  await failUntilLocked(email)
  const before = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `admin:${email}` } })
  await login(email, 'wrong')
  const later = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `admin:${email}` } })
  assert.equal(later.lockedUntil?.getTime(), before.lockedUntil?.getTime())
  assert.equal(later.failCount, before.failCount)
})

test('an unknown email gets the same answers, so the account is not revealed', async () => {
  const real = await mkAdmin()
  const fake = `nobody-${rid}-${++n}@test.local`
  keys.push(`admin:${fake}`)
  for (let i = 0; i < ADMIN_ACCOUNT_FAIL_LIMIT; i++) {
    const [a, b] = [await login(real, 'wrong'), await login(fake, 'wrong')]
    assert.equal(a.status, b.status)
    assert.deepEqual(await a.json(), await b.json())
  }
  const [a, b] = [await login(real, 'wrong'), await login(fake, 'wrong')]
  assert.equal(a.status, 429)
  assert.equal(b.status, 429)
  assert.deepEqual(await a.json(), await b.json())
})

test('both sign-in paths share the count: failures on one lock the other', async () => {
  const a = await mkAdmin()
  for (let i = 0; i < ADMIN_ACCOUNT_FAIL_LIMIT; i++) assert.equal(await viaNextAuth(a, 'wrong'), null)
  assert.equal((await login(a, PASSWORD)).status, 429)

  const b = await mkAdmin()
  await failUntilLocked(b)
  assert.equal(await viaNextAuth(b, PASSWORD), null)

  const c = await mkAdmin()
  assert.equal((await viaNextAuth(c, PASSWORD))?.id !== undefined, true)
})

test('one address guessing across accounts is stopped, without locking those accounts', async () => {
  const ip = freshIp()
  const victim = await mkAdmin()
  for (let i = 0; i < ADMIN_IP_FAIL_LIMIT; i++) {
    const fake = `spray-${rid}-${i}@test.local`
    keys.push(`admin:${fake}`)
    assert.equal((await login(fake, 'wrong', ip)).status, 401)
  }
  assert.equal((await login(victim, PASSWORD, ip)).status, 429)
  assert.equal(await prisma.loginAttempt.count({ where: { key: `admin:${victim}` } }), 0, 'the account itself was not touched')
  assert.equal((await login(victim, PASSWORD)).status, 200, 'another address gets in')
})

test('only the proxy-appended address counts, so a forged header cannot evade the limit', async () => {
  const ip = freshIp()
  const fake = `forged-${rid}@test.local`
  keys.push(`admin:${fake}`)
  await login(fake, 'wrong', `1.1.1.1, ${ip}`)
  await login(fake, 'wrong', `2.2.2.2, ${ip}`)
  assert.equal((await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `ip:admin:${ip}` } })).failCount, 2)
})

test('a lock is audited once, without the password', async () => {
  const email = await mkAdmin()
  await failUntilLocked(email)
  await login(email, 'wrong')
  const rows = await prisma.auditLog.findMany({ where: { action: 'admin_login_locked', details: { contains: email } } })
  assert.equal(rows.length, 1)
  assert.ok(!rows[0].details?.includes('wrong'))
})

test('a non-string email or password is refused, not a 500', async () => {
  const bad = (body: unknown) => POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }))
  assert.equal((await bad({ email: 42, password: 'x' })).status, 400)
  assert.equal((await bad({ email: 'a@b.c', password: { x: 1 } })).status, 400)
})

test('a parallel burst of guesses cannot get past the limit: only 5 ever reach the password check', async () => {
  const email = await mkAdmin()
  const results = await Promise.all(Array.from({ length: 30 }, () => login(email, 'wrong')))
  const statuses = results.map(r => r.status)
  assert.equal(statuses.filter(x => x === 401).length, ADMIN_ACCOUNT_FAIL_LIMIT)
  assert.equal(statuses.filter(x => x === 429).length, 30 - ADMIN_ACCOUNT_FAIL_LIMIT)
  // The burst must end in a real, short lock, not a count stuck past the limit that shuts the owner out for good.
  const row = await prisma.loginAttempt.findUniqueOrThrow({ where: { key: `admin:${email}` } })
  assert.equal(row.failCount, ADMIN_ACCOUNT_FAIL_LIMIT)
  assert.ok(row.lockedUntil && row.lockedUntil.getTime() > Date.now())
  await prisma.loginAttempt.update({ where: { key: `admin:${email}` }, data: { lockedUntil: new Date(Date.now() - 1000) } })
  assert.equal((await login(email, PASSWORD)).status, 200, 'and the owner gets in once it ends')
})

test('signing in does not count against the address', async () => {
  const ip = freshIp()
  const email = await mkAdmin()
  for (let i = 0; i < ADMIN_IP_FAIL_LIMIT + 2; i++) assert.equal((await login(email, PASSWORD, ip)).status, 200)
})

test('after a lock ends the count starts again, so one typo does not re-lock', async () => {
  const email = await mkAdmin()
  await failUntilLocked(email)
  await prisma.loginAttempt.update({ where: { key: `admin:${email}` }, data: { lockedUntil: new Date(Date.now() - 1000) } })
  assert.equal((await login(email, 'typo')).status, 401)
  assert.equal((await login(email, PASSWORD)).status, 200)
})

test('if the limit cannot be recorded, sign-in is refused rather than left uncounted', async () => {
  const email = await mkAdmin()
  const delegate = prisma.loginAttempt as unknown as { updateMany: (a: unknown) => Promise<unknown> }
  const real = delegate.updateMany
  delegate.updateMany = () => Promise.reject(new Error('database is locked'))
  try {
    assert.equal((await login(email, PASSWORD)).status, 429)
  } finally {
    delegate.updateMany = real
  }
  assert.equal((await login(email, PASSWORD)).status, 200, 'and recovers once the database does')
})

test('a malformed forwarded address is not used as a key', () => {
  assert.equal(adminIpFromForwarded('1.2.3.4, 5.6.7.8'), '5.6.7.8')
  assert.equal(adminIpFromForwarded('::1'), '::1')
  assert.equal(adminIpFromForwarded('1.2.3.4, not-an-ip'), null)
  assert.equal(adminIpFromForwarded(null), null)
})

test('the NextAuth path also refuses non-string credentials rather than crashing', async () => {
  assert.equal(await authorize({ email: { contains: '@' }, password: 'x' } as unknown as Record<string, string>), null)
  assert.equal(await authorize({ email: 'a@b.c', password: { not: '' } } as unknown as Record<string, string>), null)
})

test('the random cleanup running on every failure never turns a normal attempt into a false lock', async () => {
  const realRandom = Math.random
  Math.random = () => 0 // every failure sweeps, racing the next attempt
  try {
    for (let round = 0; round < 8; round++) {
      const email = await mkAdmin()
      const results = await Promise.all([login(email, 'wrong'), login(`nobody-${rid}-${++n}@test.local`, 'wrong'), login(`nobody-${rid}-${++n}@test.local`, 'wrong')])
      assert.deepEqual(results.map(r => r.status), [401, 401, 401])
      assert.equal((await login(email, PASSWORD)).status, 200)
    }
  } finally {
    Math.random = realRandom
  }
})

test('a row removed between steps is recreated, not read as a lock', async () => {
  const email = await mkAdmin()
  const delegate = prisma.loginAttempt as unknown as { updateMany: (a: unknown) => Promise<unknown> }
  const real = delegate.updateMany
  let once = true
  delegate.updateMany = async (a: unknown) => {
    const r = await real.call(delegate, a)
    if (once) { once = false; await prisma.loginAttempt.deleteMany({ where: { key: `admin:${email}` } }) }
    return r
  }
  try {
    keys.push(`ip:admin:none`)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) }))
    assert.equal(res.status, 200)
  } finally {
    delegate.updateMany = real
  }
})

test('a brief database lock is retried, so the owner is not refused for it', async () => {
  const email = await mkAdmin()
  const delegate = prisma.loginAttempt as unknown as { updateMany: (a: unknown) => Promise<unknown> }
  const real = delegate.updateMany
  let once = true
  delegate.updateMany = (a: unknown) => {
    if (once) { once = false; return Promise.reject(new Error('database is locked')) }
    return real.call(delegate, a)
  }
  try {
    assert.equal((await login(email, PASSWORD)).status, 200)
  } finally {
    delegate.updateMany = real
  }
})
