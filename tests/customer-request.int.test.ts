// A cash saver is a request until the super admin approves it: nothing exists and nothing is charged before then.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { approveCustomerRequest, cancelCustomerRequest, denyCustomerRequest, nextCustomerCode, parseRequestBody, rollForward, type RequestPlan } from '../src/lib/customer-request'
import { DEFAULT_FLEXIBLE_SETTINGS as flex } from '../src/lib/flexible-savings'
import { REGISTRATION_FEE } from '../src/lib/wallet-rates'
import { backfillEvents } from '../src/lib/notification-sweep'
import { welcomeText } from '../src/lib/customer-request-email'

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
const admin = { id: 'admin-1', name: 'Boss', type: 'superadmin' as const }
const rid = Math.random().toString(36).slice(2, 8)
const NOW = new Date(2026, 10, 10, 9)
let seq = 0
let agentId = ''

const phone = () => `080${String(10000000 + ++seq + Math.floor(Math.random() * 80000000)).slice(0, 8)}`
const body = (over: Record<string, unknown> = {}) => ({
  firstName: 'Ada', lastName: 'Obi', phone: phone(), address: '1 Market Rd', gender: 'Female', state: 'Lagos', lga: 'Ikeja', dob: '1990-05-01', photoUrl: PHOTO,
  plans: [{ dailyAmount: '500', periodDays: 31, goal: 'Rent', cadence: 'daily', startDate: '2026-11-10' }], ...over,
})

async function pending(over: Record<string, unknown> = {}) {
  const p = parseRequestBody(body(over), flex, NOW)
  assert.ok(p.ok, !p.ok ? p.error : '')
  return prisma.customerRequest.create({ data: { ...p.value, agentId } })
}
const wallet = async () => (await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })).walletBalance
const setWallet = (walletBalance: number) => prisma.agent.update({ where: { id: agentId }, data: { walletBalance } })

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CR-${rid}`, phone: `0751${rid}`, name: 'Agent C', location: 'Ikeja', password: 'x' } })
  agentId = a.id
})

test('a submission needs a photo and takes its fee from the server, not the browser', () => {
  const noPhoto = parseRequestBody(body({ photoUrl: '' }), flex, NOW)
  assert.equal(noPhoto.ok, false)
  assert.equal(parseRequestBody(body({ dob: '' }), flex, NOW).ok, false) // date of birth required
  const p = parseRequestBody(body({ registrationFee: '1', status: 'Approved', agentId: 'someone-else' }), flex, NOW)
  assert.ok(p.ok)
  assert.equal(p.value.registrationFee, REGISTRATION_FEE)
  assert.equal('status' in p.value, false)
  assert.equal('agentId' in p.value, false)
})

test('a stray customer ID can\u2019t produce a broken CST number', () => {
  assert.equal(nextCustomerCode([{ customerId: 'CST-Zabc' }, { customerId: 'CST-00NaN' }, { customerId: 'CST-00041' }]), 'CST-00042')
  assert.equal(nextCustomerCode([]), 'CST-00001')
})

test('the welcome text fits one SMS and names the account', () => {
  const t = welcomeText({ firstName: 'Ada', customerCode: 'CST-00042', agentName: 'Bola Ade' })
  assert.ok(t.includes('CST-00042'))
  assert.ok(t.length <= 160, `${t.length} characters`)
})

test('a plan that waited starts on the approval day and keeps its full length', () => {
  const plan: RequestPlan = { dailyAmount: 0, periodDays: 90, goal: 'x', cadence: 'flexible', startDate: '2026-11-01', endDate: '2027-03-01', notes: null }
  const moved = rollForward(plan, NOW)
  assert.equal(moved.startDate, '2026-11-10')
  assert.equal(moved.endDate, '2027-03-10')
  assert.equal(rollForward({ ...plan, startDate: '2026-11-20' }, NOW).startDate, '2026-11-20')
})

test('nothing exists until approval; approval creates the customer and takes the fee', async () => {
  await setWallet(2000)
  const r = await pending()
  assert.equal(await prisma.customer.count({ where: { phone: r.phone } }), 0)
  assert.equal(await wallet(), 2000)

  const out = await approveCustomerRequest(prisma, { id: r.id, admin })
  assert.ok(out.ok, !out.ok ? out.error : '')
  assert.equal(await wallet(), 2000 - REGISTRATION_FEE)
  const c = await prisma.customer.findFirstOrThrow({ where: { customerId: out.customerCode }, include: { savingsPlans: true, transactions: true } })
  assert.equal(c.agentId, agentId)
  assert.equal(c.photoUrl, PHOTO)
  assert.equal(c.savingsPlans.length, 1)
  assert.deepEqual(c.transactions.map(t => t.type).sort(), ['enrolment', 'registration'])
  const after = await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } })
  assert.equal(after.status, 'Approved')
  assert.equal(after.photoUrl, null)
  assert.equal(after.pendingPhone, null)
  assert.equal(await prisma.notification.count({ where: { dedupeKey: `customer-request-approved:${r.id}` } }), 1)
})

test('two admins approving at once create one customer and charge once', async () => {
  await setWallet(5000)
  const r = await pending()
  const [a, b] = await Promise.all([approveCustomerRequest(prisma, { id: r.id, admin }), approveCustomerRequest(prisma, { id: r.id, admin })])
  assert.equal([a, b].filter(x => x.ok).length, 1)
  assert.equal(await prisma.customer.count({ where: { phone: r.phone } }), 1)
  assert.equal(await wallet(), 5000 - REGISTRATION_FEE)
})

test('a short wallet stops the approval, leaves it waiting and tells the agent', async () => {
  await setWallet(100)
  const r = await pending()
  const out = await approveCustomerRequest(prisma, { id: r.id, admin })
  assert.equal(out.ok, false)
  assert.equal(await prisma.customer.count({ where: { phone: r.phone } }), 0)
  assert.equal(await wallet(), 100)
  assert.equal((await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'Pending')
  assert.equal(await prisma.notification.count({ where: { recipientId: agentId, kind: 'customer_request_needs_funds' } }), 1)
})

test('a waiting phone number can’t be used twice, and a denial frees it', async () => {
  await setWallet(2000)
  const first = await pending()
  const p = parseRequestBody(body({ phone: first.phone }), flex, NOW)
  assert.ok(p.ok)
  await assert.rejects(prisma.customerRequest.create({ data: { ...p.value, agentId } }), (e: { code?: string }) => e.code === 'P2002')

  const denied = await denyCustomerRequest(prisma, { id: first.id, admin, reason: 'Not a real photo', fix: 'Take a passport photo' }, NOW)
  assert.ok(denied.ok)
  const row = await prisma.customerRequest.findUniqueOrThrow({ where: { id: first.id } })
  assert.equal(row.status, 'Denied')
  assert.equal(row.denyFix, 'Take a passport photo')
  assert.equal(row.pendingPhone, null)
  assert.equal(await wallet(), 2000)
  assert.equal(await prisma.customer.count({ where: { phone: first.phone } }), 0)
  await prisma.customerRequest.create({ data: { ...p.value, agentId } })
  assert.equal((await denyCustomerRequest(prisma, { id: first.id, admin, reason: 'xxx', fix: 'yyy' }, NOW)).ok, false)
})

test('a phone that became another account blocks approval', async () => {
  await setWallet(2000)
  const r = await pending()
  await prisma.customer.create({ data: { customerId: `CST-Z${rid}`, agentId, firstName: 'X', lastName: 'Y', phone: r.phone, address: 'a', nokName: '', nokRelation: '', nokPhone: '' } })
  const out = await approveCustomerRequest(prisma, { id: r.id, admin })
  assert.equal(out.ok, false)
  assert.equal(await wallet(), 2000)
})

test('the nightly net rebuilds decisions with the live keys', () => {
  const decidedAt = new Date(NOW)
  const events = backfillEvents({
    savings: [], collections: [], withdrawals: [], topUps: [],
    customerRequests: [
      { id: 'a', agentId: 'g', status: 'Approved', firstName: 'A', lastName: 'B', customerCode: 'CST-1', decidedAt },
      { id: 'd', agentId: 'g', status: 'Denied', firstName: 'A', lastName: 'B', customerCode: null, decidedAt },
    ],
  }, { since: new Date(decidedAt.getTime() - 1000) })
  assert.deepEqual(events.map(e => e.dedupeKey), ['customer-request-approved:a', `customer-request-denied:d:${decidedAt.getTime()}`])
})

test('the agent can cancel a waiting or denied request; it frees the phone and charges nothing', async () => {
  await setWallet(2000)
  const first = await pending()
  const stranger = { id: 'not-the-agent', name: 'Someone' }
  assert.equal((await cancelCustomerRequest(prisma, { agent: stranger, id: first.id })).ok, false)
  assert.ok((await cancelCustomerRequest(prisma, { agent: { id: agentId, name: 'Agent' }, id: first.id })).ok)
  const row = await prisma.customerRequest.findUniqueOrThrow({ where: { id: first.id } })
  assert.equal(row.status, 'Cancelled')
  assert.equal(row.pendingPhone, null)
  assert.equal((await approveCustomerRequest(prisma, { id: first.id, admin }, NOW)).ok, false)
  assert.equal(await wallet(), 2000)

  const second = await pending()
  assert.ok((await denyCustomerRequest(prisma, { id: second.id, admin, reason: 'Blurry', fix: 'Retake' }, NOW)).ok)
  assert.ok((await cancelCustomerRequest(prisma, { agent: { id: agentId, name: 'Agent' }, id: second.id })).ok)
  assert.equal((await cancelCustomerRequest(prisma, { agent: { id: agentId, name: 'Agent' }, id: second.id })).ok, false)
})
