// Integration test: createCardBatch generates serials server-side and persists
// them, ignoring any client-supplied serials. Against the worktree dev.db.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { createCardBatch, SERIAL_RE } from '../src/lib/member-card'

const batchName = `TEST-${Math.random().toString(36).slice(2, 8)}`
let batchId = ''

after(async () => {
  await prisma.memberCard.deleteMany({ where: { batchName } })
  await prisma.$disconnect()
})

test('creates exactly `quantity` cards with crypto serials, all Unlinked', async () => {
  const res = await createCardBatch(prisma, { batchName, quantity: 6, expiryDate: new Date(Date.now() + 365 * 86400_000) })
  batchId = res.batchId
  assert.match(res.batchId, /^[0-9A-F]{8}$/)
  assert.equal(res.cards.length, 6)
  for (const c of res.cards) assert.match(c.serial, SERIAL_RE)
  assert.equal(new Set(res.cards.map(c => c.serial)).size, 6)

  const rows = await prisma.memberCard.findMany({ where: { batchId } })
  assert.equal(rows.length, 6)
  assert.ok(rows.every(r => r.status === 'Unlinked'))
  assert.ok(rows.every(r => SERIAL_RE.test(r.serial)))
})

test('serials are not sequential (no shared counter prefix)', async () => {
  const bodies = (await prisma.memberCard.findMany({ where: { batchId }, select: { serial: true } }))
    .map(r => r.serial.slice(4))
  // In the old scheme these differed only in the last digits. Now the whole
  // body is random, so sorting won't produce a clean 000001,000002,… run.
  assert.ok(new Set(bodies.map(b => b.slice(0, 4))).size > 1, 'bodies share no fixed prefix')
})
