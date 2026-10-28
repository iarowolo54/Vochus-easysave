// Integration test for the DB-backed throttle layer (account hard lock + IP
// spray rule). Runs against the worktree's own local prisma/dev.db. Randomised
// keys, cleaned up, safe to re-run.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginThrottle,
  unlockAccount,
  isPhoneLocked,
  sweepStaleLoginAttempts,
} from '../src/lib/login-attempt'
import { THROTTLE, ACCOUNT_FAIL_LIMIT } from '../src/lib/login-throttle'

const rid = Math.random().toString(36).slice(2, 10)
const phone = `+234999${rid}`
const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`
const t0 = 1_000_000_000_000

after(async () => {
  await prisma.loginAttempt.deleteMany({
    where: { OR: [{ key: { startsWith: `phone:${phone}` } }, { key: `ip:${ip}` }] },
  })
  await prisma.$disconnect()
})

test('a fresh account is not locked', async () => {
  const r = await checkLoginThrottle({ phone, ip }, t0)
  assert.equal(r.accountLocked, false)
  assert.equal(r.blocked, false)
})

test('the account locks on the 4th failure, not the 3rd', async () => {
  let now = t0
  for (let i = 0; i < 3; i++) {
    now += 1000
    await recordLoginFailure({ phone, ip }, now)
  }
  assert.equal((await checkLoginThrottle({ phone, ip }, now)).accountLocked, false)

  now += 1000
  await recordLoginFailure({ phone, ip }, now) // 4th
  const r = await checkLoginThrottle({ phone, ip }, now)
  assert.equal(r.accountLocked, true)
  assert.equal(r.blocked, true)
  assert.equal(await isPhoneLocked(phone), true)
})

test('the lock has no time expiry (still locked far in the future)', async () => {
  const r = await checkLoginThrottle({ phone, ip }, t0 + 365 * 24 * 60 * 60_000)
  assert.equal(r.accountLocked, true)
})

test('unlockAccount clears the lock', async () => {
  await unlockAccount(phone)
  assert.equal(await isPhoneLocked(phone), false)
  assert.equal(await prisma.loginAttempt.findUnique({ where: { key: `phone:${phone}` } }), null)
})

test('a successful login clears the account lock', async () => {
  await recordLoginFailure({ phone }, t0)
  await recordLoginFailure({ phone }, t0 + 1000)
  await clearLoginThrottle({ phone })
  assert.equal(await isPhoneLocked(phone), false)
})

test('concurrent failures are counted atomically (reach the lock)', async () => {
  const cphone = `+234911${rid}`
  const key = `phone:${cphone}`
  try {
    await recordLoginFailure({ phone: cphone }, t0) // seed row at 1
    await Promise.all(
      Array.from({ length: 3 }, () => recordLoginFailure({ phone: cphone }, t0 + 1000)),
    )
    const row = await prisma.loginAttempt.findUnique({ where: { key } })
    assert.ok((row?.failCount ?? 0) >= ACCOUNT_FAIL_LIMIT, `failCount=${row?.failCount}`)
    assert.equal(await isPhoneLocked(cphone), true)
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { key } })
  }
})

test('IP spray rule is independent of accounts and trips only at 20', async () => {
  const sprayIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`
  try {
    let now = t0
    for (let i = 0; i < 19; i++) {
      now += 1000
      await recordLoginFailure({ phone: `${phone}-${i}`, ip: sprayIp }, now)
    }
    // Each distinct account saw one failure — none locked; IP still under 20.
    assert.equal((await checkLoginThrottle({ phone: `${phone}-fresh`, ip: sprayIp }, now + 1000)).blocked, false)

    now += 1000
    await recordLoginFailure({ phone: `${phone}-20`, ip: sprayIp }, now)
    const r = await checkLoginThrottle({ phone: `${phone}-fresh2`, ip: sprayIp }, now + 1000)
    assert.equal(r.blocked, true)
    assert.ok(r.retryAfterSeconds > 0)
    assert.equal(r.accountLocked, false) // it's an IP lock, not an account lock
  } finally {
    await prisma.loginAttempt.deleteMany({
      where: { OR: [{ key: { startsWith: `phone:${phone}-` } }, { key: `ip:${sprayIp}` }] },
    })
  }
})

test('sweep deletes stale rows but never a locked account', async () => {
  const now = t0 + 100 * 60_000
  const staleKey = `phone:stale-${rid}`
  const lockedKey = `phone:locked-${rid}`
  try {
    await prisma.loginAttempt.create({
      data: { key: staleKey, failCount: 2, lastFailAt: new Date(now - THROTTLE.resetAfterMs - 1), lockedUntil: null },
    })
    await prisma.loginAttempt.create({
      data: { key: lockedKey, failCount: ACCOUNT_FAIL_LIMIT, lastFailAt: new Date(now - THROTTLE.resetAfterMs - 1), lockedUntil: null },
    })
    await sweepStaleLoginAttempts(now)
    assert.equal(await prisma.loginAttempt.findUnique({ where: { key: staleKey } }), null)
    assert.notEqual(await prisma.loginAttempt.findUnique({ where: { key: lockedKey } }), null)
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { key: { in: [staleKey, lockedKey] } } })
  }
})
