// Integration test for the DB-backed throttle layer. Runs against the worktree's
// own local prisma/dev.db (isolated from prod/staging). Uses randomised keys and
// cleans them up so it is safe to re-run.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginThrottle,
  sweepStaleLoginAttempts,
} from '../src/lib/login-attempt'
import { THROTTLE } from '../src/lib/login-throttle'

const rid = Math.random().toString(36).slice(2, 10)
const phone = `+234999${rid}`
const ip = `203.0.113.${(Math.floor(Math.random() * 254) + 1)}`
const t0 = 1_000_000_000_000

after(async () => {
  await prisma.loginAttempt.deleteMany({
    where: { key: { in: [`phone:${phone}`, `ip:${ip}`] } },
  })
  await prisma.$disconnect()
})

test('a fresh account is not throttled', async () => {
  const r = await checkLoginThrottle({ phone, ip }, t0)
  assert.equal(r.blocked, false)
})

test('five failures lock the account and report Retry-After', async () => {
  let now = t0
  for (let i = 0; i < 5; i++) {
    now += 1000
    await recordLoginFailure({ phone, ip }, now)
  }
  const r = await checkLoginThrottle({ phone, ip }, now + 5_000)
  assert.equal(r.blocked, true)
  assert.ok(r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 30, `retryAfter=${r.retryAfterSeconds}`)
})

test('success clears the account throttle', async () => {
  await clearLoginThrottle({ phone })
  const r = await checkLoginThrottle({ phone, ip }, t0 + 10_000)
  assert.equal(r.blocked, false)
  const row = await prisma.loginAttempt.findUnique({ where: { key: `phone:${phone}` } })
  assert.equal(row, null)
})

test('concurrent failures are counted atomically (no lost updates)', async () => {
  const cphone = `+234911${rid}`
  const key = `phone:${cphone}`
  try {
    // Seed one failure so the row exists and later calls take the atomic path.
    await recordLoginFailure({ phone: cphone }, t0)
    // Fire nine more in parallel — a burst an attacker could send.
    await Promise.all(
      Array.from({ length: 9 }, () => recordLoginFailure({ phone: cphone }, t0 + 1000)),
    )
    const row = await prisma.loginAttempt.findUnique({ where: { key } })
    assert.equal(row?.failCount, 10, 'all 10 failures must be counted')
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { key } })
  }
})

test('sweep deletes stale rows but keeps active locks', async () => {
  const now = t0 + 100 * 60_000
  const staleKey = `phone:stale-${rid}`
  const activeKey = `phone:active-${rid}`
  try {
    await prisma.loginAttempt.create({
      data: {
        key: staleKey,
        failCount: 3,
        lastFailAt: new Date(now - THROTTLE.resetAfterMs - 1), // window long expired
        lockedUntil: null, // not locked
      },
    })
    await prisma.loginAttempt.create({
      data: {
        key: activeKey,
        failCount: 10,
        lastFailAt: new Date(now - 1000),
        lockedUntil: new Date(now + 60_000), // still locked
      },
    })
    const deleted = await sweepStaleLoginAttempts(now)
    assert.ok(deleted >= 1)
    assert.equal(await prisma.loginAttempt.findUnique({ where: { key: staleKey } }), null)
    assert.notEqual(await prisma.loginAttempt.findUnique({ where: { key: activeKey } }), null)
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { key: { in: [staleKey, activeKey] } } })
  }
})

test('IP throttle is independent of account and only trips on spraying', async () => {
  // A dedicated IP so this test starts from zero regardless of the others.
  const sprayIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`
  try {
    // 19 failures across DIFFERENT accounts from one IP: each account stays at 1
    // (no per-account lock), and the IP is still under its threshold.
    let now = t0
    for (let i = 0; i < 19; i++) {
      now += 1000
      await recordLoginFailure({ phone: `${phone}-${i}`, ip: sprayIp }, now)
    }
    let r = await checkLoginThrottle({ phone: `${phone}-fresh`, ip: sprayIp }, now + 1000)
    assert.equal(r.blocked, false) // IP under its threshold → not blocked

    now += 1000
    await recordLoginFailure({ phone: `${phone}-20`, ip: sprayIp }, now)
    r = await checkLoginThrottle({ phone: `${phone}-fresh2`, ip: sprayIp }, now + 1000)
    assert.equal(r.blocked, true)
  } finally {
    await prisma.loginAttempt.deleteMany({
      where: {
        OR: [{ key: { startsWith: `phone:${phone}-` } }, { key: `ip:${sprayIp}` }],
      },
    })
  }
})
