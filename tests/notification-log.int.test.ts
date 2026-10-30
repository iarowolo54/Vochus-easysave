// Integration tests for the NotificationLog dedupe record (weekly summary sent once per ISO week).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
const logIds: string[] = []

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `NL-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `NL-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0795${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.notificationLog.deleteMany({ where: { id: { in: logIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('creates a log row and reads it back', async () => {
  const row = await prisma.notificationLog.create({ data: { customerId, kind: 'weekly_summary', periodKey: '2026-W44' } })
  logIds.push(row.id)
  const found = await prisma.notificationLog.findUnique({ where: { id: row.id } })
  assert.equal(found?.customerId, customerId)
  assert.equal(found?.kind, 'weekly_summary')
  assert.equal(found?.periodKey, '2026-W44')
  assert.ok(found?.sentAt instanceof Date)
})

test('duplicate (customerId, kind, periodKey) rejects with P2002', async () => {
  const first = await prisma.notificationLog.create({ data: { customerId, kind: 'weekly_summary', periodKey: '2026-W45' } })
  logIds.push(first.id)
  await assert.rejects(
    () => prisma.notificationLog.create({ data: { customerId, kind: 'weekly_summary', periodKey: '2026-W45' } }),
    (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
  )
  const other = await prisma.notificationLog.create({ data: { customerId, kind: 'weekly_summary', periodKey: '2026-W46' } })
  logIds.push(other.id)
})
