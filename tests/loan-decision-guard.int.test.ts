// Admin loan approve/reject must only transition a Pending loan. getServerSession is stubbed via
// a module-load hook (see savings-interest-admin.int.test.ts). Rows are scoped by a run id and deleted by id.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => ({ user: { id: 'adm', name: 'Test Admin', role: 'superadmin' } }) }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
/* eslint-disable @typescript-eslint/no-require-imports */
const approve = (require('../src/app/api/admin/loans/[id]/approve/route') as typeof import('../src/app/api/admin/loans/[id]/approve/route')).PATCH
const reject = (require('../src/app/api/admin/loans/[id]/reject/route') as typeof import('../src/app/api/admin/loans/[id]/reject/route')).PATCH
/* eslint-enable @typescript-eslint/no-require-imports */

const rid = Math.random().toString(36).slice(2, 8)
let agentDbId = '', custDbId = ''
const loanIds: string[] = []
let n = 0

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `LG${rid}`, phone: `0761${rid}`, name: 'A', location: 'L', password: 'x' } })
  agentDbId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `LG${rid}`, agentId: agentDbId, firstName: 'F', lastName: 'L', phone: `0762${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0', password: 'HASH', photoUrl: 'data:image/png;base64,AAAA',
      gender: 'Female', state: 'Lagos', lga: 'Ikeja',
    },
  })
  custDbId = c.id
})

after(async () => {
  M._load = realLoad
  if (loanIds.length) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: loanIds } } }).catch(() => {})
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } })
  }
  await prisma.customer.delete({ where: { id: custDbId } })
  await prisma.agent.delete({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

async function mkLoan(status: string) {
  const l = await prisma.loan.create({
    data: {
      ref: `LG${rid}-${n++}`, agentId: agentDbId, customerId: custDbId, principal: 1000, interestRate: 10,
      interestAmount: 100, totalAmount: 1100, durationDays: 30, dueDate: new Date(Date.now() + 86400000), status,
    },
  })
  loanIds.push(l.id)
  return l.id
}
const call = (fn: typeof approve, id: string) => fn({} as never, { params: Promise.resolve({ id }) })
const statusOf = async (id: string) => (await prisma.loan.findUniqueOrThrow({ where: { id } })).status

test('approving a Pending loan succeeds once, second attempt 409', async () => {
  const id = await mkLoan('Pending')
  const r1 = await call(approve, id)
  assert.equal(r1.status, 200)
  assert.equal(await statusOf(id), 'Approved')
  const r2 = await call(approve, id)
  assert.equal(r2.status, 409)
  assert.deepEqual(await r2.json(), { error: 'This loan was already decided' })
})

for (const s of ['Rejected', 'Disbursed', 'Repaid']) {
  test(`approve on ${s} loan -> 409, status unchanged`, async () => {
    const id = await mkLoan(s)
    const r = await call(approve, id)
    assert.equal(r.status, 409)
    assert.equal(await statusOf(id), s)
  })
  test(`reject on ${s} loan -> 409, status unchanged`, async () => {
    const id = await mkLoan(s)
    const r = await call(reject, id)
    assert.equal(r.status, 409)
    assert.equal(await statusOf(id), s)
  })
}

test('rejecting a Pending loan succeeds once, second attempt 409', async () => {
  const id = await mkLoan('Pending')
  assert.equal((await call(reject, id)).status, 200)
  assert.equal(await statusOf(id), 'Rejected')
  assert.equal((await call(reject, id)).status, 409)
  assert.equal((await call(approve, id)).status, 409)
  assert.equal(await statusOf(id), 'Rejected')
})
