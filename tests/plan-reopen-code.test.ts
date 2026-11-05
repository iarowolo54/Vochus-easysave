import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { requestReopenCode, confirmReopenCode } from '../src/lib/plan-reopen-code'

const cust = { id: `test-reopen-${Date.now()}`, phone: '08000000000', firstName: 'Ada' }
after(async () => { await prisma.passwordResetOtp.deleteMany({ where: { actorId: cust.id } }); await prisma.$disconnect() })

function capture() {
  const sent: string[] = []
  return { sent, send: async (_c: unknown, code: string) => { sent.push(code); return true } }
}

test('the right code works once, for its own plan only', async () => {
  const c = capture()
  const r = await requestReopenCode(cust, 'planA', true, c.send)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.sentTo.slice(-4), '0000')
  assert.equal(await confirmReopenCode(cust.id, 'planB', r.resetId, c.sent[0]), false, 'another plan')
  assert.equal(await confirmReopenCode(cust.id, 'planA', r.resetId, c.sent[0]), true)
  assert.equal(await confirmReopenCode(cust.id, 'planA', r.resetId, c.sent[0]), false, 'used up')
})

test('a wrong code fails and five wrong tries kill the code', async () => {
  const cust2 = { ...cust, id: cust.id + 'b' }
  const c = capture()
  const r = await requestReopenCode(cust2, 'planA', false, c.send)
  assert.ok(r.ok)
  if (!r.ok) return
  const wrong = c.sent[0] === '123456' ? '654321' : '123456'
  for (let i = 0; i < 5; i++) assert.equal(await confirmReopenCode(cust2.id, 'planA', r.resetId, wrong), false)
  assert.equal(await confirmReopenCode(cust2.id, 'planA', r.resetId, c.sent[0]), false, 'dead after five tries')
  await prisma.passwordResetOtp.deleteMany({ where: { actorId: cust2.id } })
})

test('someone else cannot use the code, and a failed text leaves no usable code', async () => {
  const cust3 = { ...cust, id: cust.id + 'c' }
  const c = capture()
  const r = await requestReopenCode(cust3, 'planA', false, c.send)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(await confirmReopenCode('someone-else', 'planA', r.resetId, c.sent[0]), false)
  const failed = await requestReopenCode({ ...cust3, id: cust3.id + 'x' }, 'planA', false, async () => false)
  assert.deepEqual(failed, { ok: false, reason: 'not_sent' })
  assert.equal(await prisma.passwordResetOtp.count({ where: { actorId: cust3.id + 'x', consumedAt: null } }), 0)
  await prisma.passwordResetOtp.deleteMany({ where: { actorId: { startsWith: cust3.id } } })
})
