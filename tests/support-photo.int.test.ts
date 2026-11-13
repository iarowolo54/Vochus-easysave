// GET /api/admin/support/photo: View-only staff see photos only of people who have a support chat; anyone else's needs
// Manage (the permission the New message search requires). Session is stubbed like send-receipt.int.test.ts.
process.env.NEXTAUTH_SECRET ??= 'test-secret'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../src/app/api/admin/support/photo/route') as typeof import('../src/app/api/admin/support/photo/route')

const RUN = Math.random().toString(36).slice(2, 8)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ids = { agent: '', withChat: '', noChat: '', dept: '', viewRole: '', manageRole: '', viewer: '', manager: '', thread: '' }

const get = (customerId: string) => GET({ url: `http://x/api/admin/support/photo?customer=${customerId}` } as never)
const asStaff = (id: string | null) => { stub.getServerSession = async () => (id ? { user: { id, role: 'staff', name: 'Staff' } } : null) }

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SPH-${RUN}`, phone: `0797${RUN}`, name: 'Photo Agent', location: 'x', password: 'x' } })
  ids.agent = a.id
  const mk = (sfx: string) => prisma.customer.create({ data: {
    customerId: `SPH${sfx}-${RUN}`, agentId: a.id, firstName: 'P', lastName: sfx, phone: `08${sfx}9${RUN}`.slice(0, 11).padEnd(11, '0'),
    address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800', photoUrl: PNG } })
  ids.withChat = (await mk('A')).id
  ids.noChat = (await mk('B')).id
  ids.thread = (await prisma.supportThread.create({ data: { customerId: ids.withChat } })).id
  const d = await prisma.department.create({ data: { name: `SPH dept ${RUN}` } })
  ids.dept = d.id
  ids.viewRole = (await prisma.role.create({ data: { departmentId: d.id, name: 'view', permissions: JSON.stringify(['support:view']) } })).id
  ids.manageRole = (await prisma.role.create({ data: { departmentId: d.id, name: 'manage', permissions: JSON.stringify(['support:manage']) } })).id
  ids.viewer = (await prisma.staffUser.create({ data: { name: 'Viewer', email: `sph-v-${RUN}@example.test`, status: 'Active', roleId: ids.viewRole, departmentId: d.id } })).id
  ids.manager = (await prisma.staffUser.create({ data: { name: 'Manager', email: `sph-m-${RUN}@example.test`, status: 'Active', roleId: ids.manageRole, departmentId: d.id } })).id
})

after(async () => {
  await prisma.supportThread.deleteMany({ where: { id: ids.thread } })
  await prisma.customer.deleteMany({ where: { id: { in: [ids.withChat, ids.noChat] } } })
  await prisma.agent.deleteMany({ where: { id: ids.agent } })
  await prisma.staffUser.deleteMany({ where: { id: { in: [ids.viewer, ids.manager] } } })
  await prisma.role.deleteMany({ where: { id: { in: [ids.viewRole, ids.manageRole] } } })
  await prisma.department.deleteMany({ where: { id: ids.dept } })
  await prisma.$disconnect()
})

test('signed out: refused', async () => {
  asStaff(null)
  assert.equal((await get(ids.withChat)).status, 401)
  assert.equal((await get(ids.noChat)).status, 401)
})

test('view-only staff: photo of someone with a chat, but not of anyone else', async () => {
  asStaff(ids.viewer)
  const ok = await get(ids.withChat)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.equal((await get(ids.noChat)).status, 403)
})

test('manage staff: anyone they could find in New message', async () => {
  asStaff(ids.manager)
  assert.equal((await get(ids.withChat)).status, 200)
  assert.equal((await get(ids.noChat)).status, 200)
})
