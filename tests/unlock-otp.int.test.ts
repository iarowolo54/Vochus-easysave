// Customer login-unlock codes against the local DB. Codes are captured from the injected sender.
// Run from a worktree only, after confirming its Prisma client points at its own dev.db.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { MAX_SENDS_PER_DAY, MAX_VERIFY_ATTEMPTS, RESEND_COOLDOWN_MS, issueResetCode, verifyResetCode } from '../src/lib/password-reset'
import { requestUnlockOtp } from '../src/lib/unlock-otp'

const rid = Math.random().toString(36).slice(2, 10)
const t0 = Date.now()
const ids: string[] = []

function mk() {
  const id = `unlock-${rid}-${ids.length}`
  ids.push(id)
  return { id, email: null, phone: '08012345678', firstName: 'Ada' }
}

async function request(customer: ReturnType<typeof mk>, now: number) {
  let code = ''
  const issued = await requestUnlockOtp(customer, now, async (_c, _t, _n, c) => { code = c; return true })
  await issued?.delivered
  return issued ? { resetId: issued.resetId, code } : null
}

const verify = (id: string, resetId: string, code: string, now: number) => verifyResetCode('customer', id, resetId, code, now, 'login_unlock')
const wrong = (code: string) => (code === '000000' ? '000001' : '000000')

after(async () => {
  await prisma.passwordResetOtp.deleteMany({ where: { actorId: { in: ids } } })
  await prisma.$disconnect()
})

test('needs the resetId, and is single use', async () => {
  const c = mk()
  const { code, resetId } = (await request(c, t0))!
  assert.equal(await verify(c.id, '', code, t0 + 1), false)
  assert.equal(await verify(c.id, 'someone-elses-id', code, t0 + 1), false)
  assert.equal(await verify(c.id, resetId, code, t0 + 2), true)
  assert.equal(await verify(c.id, resetId, code, t0 + 3), false)
})

test('a stranger without the resetId can’t use up the owner’s attempts', async () => {
  const c = mk()
  const { code, resetId } = (await request(c, t0))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS + 2; i++) await verify(c.id, 'guess', wrong(code), t0 + 1)
  assert.equal(await verify(c.id, resetId, code, t0 + 2), true)
})

test('expires, and is refused after too many wrong attempts', async () => {
  const c = mk()
  const first = (await request(c, t0))!
  assert.equal(await verify(c.id, first.resetId, first.code, t0 + 60 * 60_000), false)

  const second = (await request(c, t0 + RESEND_COOLDOWN_MS))!
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) await verify(c.id, second.resetId, wrong(second.code), t0 + RESEND_COOLDOWN_MS + 1)
  assert.equal(await verify(c.id, second.resetId, second.code, t0 + RESEND_COOLDOWN_MS + 2), false)
})

test('an unlock code works only for unlocking, and doesn’t retire a reset code', async () => {
  const c = mk()
  const unlock = (await request(c, t0))!
  const reset = (await issueResetCode('customer', c.id, t0))!
  assert.equal(await verifyResetCode('customer', c.id, unlock.resetId, unlock.code, t0 + 1), false, 'not on the reset route')
  assert.equal(await verify(c.id, reset.resetId, reset.code, t0 + 1), false, 'a reset code doesn’t unlock')
  assert.equal(await verify(c.id, unlock.resetId, unlock.code, t0 + 2), true)
  assert.equal(await verifyResetCode('customer', c.id, reset.resetId, reset.code, t0 + 3), true)
})

test('a failed delivery cancels that code but still counts toward the limits', async () => {
  const c = mk()
  const issued = (await requestUnlockOtp(c, t0, async () => false))!
  await issued.delivered
  const rows = await prisma.passwordResetOtp.findMany({ where: { actorId: c.id } })
  assert.equal(rows.length, 1)
  assert.ok(rows[0].consumedAt)
  assert.equal(await request(c, t0 + 1000), null, 'cooldown still applies')
  assert.ok(await request(c, t0 + RESEND_COOLDOWN_MS + 1))
})

test('stops at the daily cap, and stores no plain code', async () => {
  const c = mk()
  let now = t0
  for (let i = 0; i < MAX_SENDS_PER_DAY; i++) {
    const r = await request(c, now)
    assert.ok(r, `send ${i + 1}`)
    const row = await prisma.passwordResetOtp.findFirstOrThrow({ where: { actorId: c.id, resetId: r.resetId } })
    assert.notEqual(row.codeHash, r.code)
    assert.equal(row.purpose, 'login_unlock')
    now += RESEND_COOLDOWN_MS + 1
  }
  assert.equal(await request(c, now), null)
})
