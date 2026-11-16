import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentsState, eligibilityError, isOpenRequestConflict, nextAgentCode, parseUpgradeBody } from '../src/lib/agent-upgrade'
import { backfillEvents } from '../src/lib/notification-sweep'

const good = { nin: '12345678901', bvn: '', state: 'Lagos', lga: 'Ikeja', address: '12 Allen Avenue', nokName: 'Ada Obi', nokPhone: '+2348031234567' }

test('a complete form passes, with the phone normalised and an empty BVN stored as none', () => {
  const r = parseUpgradeBody(good)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.value.nokPhone, '08031234567')
  assert.equal(r.value.bvn, null)
})

test('the agent sends details only: documents and stray fields are dropped', () => {
  const r = parseUpgradeBody({ ...good, documents: [{ docType: 'id', fileName: 'x.pdf', fileData: 'data:,' }], status: 'Approved', agentId: 'other' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(Object.keys(r.value).sort(), ['address', 'bvn', 'lga', 'nin', 'nokName', 'nokPhone', 'state'])
})

test('NIN, BVN, state, LGA, address and next of kin are checked', () => {
  assert.equal(parseUpgradeBody({ ...good, nin: '123' }).ok, false)
  assert.equal(parseUpgradeBody({ ...good, bvn: '99' }).ok, false)
  assert.equal(parseUpgradeBody({ ...good, lga: 'Nowhere' }).ok, false)
  assert.equal(parseUpgradeBody({ ...good, address: 'x' }).ok, false)
  assert.equal(parseUpgradeBody({ ...good, nokPhone: '123' }).ok, false)
  assert.equal(parseUpgradeBody(null).ok, false)
})

test('only active online customers with a password can become agents, and only once', () => {
  const base = { type: 'online', status: 'Active', convertedToAgentId: null, password: 'hash' }
  assert.equal(eligibilityError(base), null)
  assert.match(eligibilityError({ ...base, type: 'offline' }) ?? '', /online/)
  assert.match(eligibilityError({ ...base, status: 'Suspended' }) ?? '', /active/)
  assert.match(eligibilityError({ ...base, status: 'Converted' }) ?? '', /already an agent/)
  assert.match(eligibilityError({ ...base, convertedToAgentId: 'a1' }) ?? '', /already an agent/)
  assert.ok(eligibilityError({ ...base, password: null }))
})

test('the new agent’s documents: missing until all sent, approved only when every one is', () => {
  const req = ['id', 'addr']
  assert.equal(documentsState(req, []), 'missing')
  assert.equal(documentsState(req, [{ docType: 'id', docApprovalStatus: 'pending' }]), 'missing')
  assert.equal(documentsState(req, [{ docType: 'id', docApprovalStatus: 'pending' }, { docType: 'addr', docApprovalStatus: 'approved' }]), 'review')
  assert.equal(documentsState(req, [{ docType: 'id', docApprovalStatus: 'rejected' }]), 'rejected')
  assert.equal(documentsState(req, [{ docType: 'id', docApprovalStatus: 'approved' }, { docType: 'addr', docApprovalStatus: 'approved' }]), 'approved')
})

test('the next agent ID follows the highest real one, never a count', () => {
  assert.equal(nextAgentCode([]), 'AGT-00001')
  assert.equal(nextAgentCode([{ agentId: 'AGT-00009' }, { agentId: 'AGT-00002' }, { agentId: 'odd' }]), 'AGT-00010')
})

test('only the open-request unique index counts as a clash', () => {
  assert.equal(isOpenRequestConflict({ code: 'P2002', meta: { target: ['pendingCustomerId'] } }), true)
  assert.equal(isOpenRequestConflict({ code: 'P2002', meta: { target: ['createdAgentId'] } }), false)
  assert.equal(isOpenRequestConflict(new Error('x')), false)
})

test('the safety net rebuilds the decision notices, and the welcome only with the new agent ID', () => {
  const since = new Date('2026-11-15T00:00:00Z')
  const t = new Date('2026-11-16T10:00:00Z')
  const row = { id: 'r1', agentId: 'a1', customer: { firstName: 'Ada', lastName: 'Obi' } }
  const keys = (agentUpgrades: Parameters<typeof backfillEvents>[0]['agentUpgrades'], codes = new Map<string, string>()) =>
    backfillEvents({ savings: [], collections: [], withdrawals: [], topUps: [], agentUpgrades }, { since, agentCodes: codes }).map(e => e.dedupeKey).sort()

  assert.deepEqual(keys([{ ...row, status: 'Pending', decidedAt: null, createdAgentId: null }]), [])
  assert.deepEqual(keys([{ ...row, status: 'Approved', decidedAt: t, createdAgentId: 'n1' }], new Map([['n1', 'AGT-00042']])), ['agent-upgrade-approved:r1', 'became-agent:r1'])
  assert.deepEqual(keys([{ ...row, status: 'Denied', decidedAt: t, createdAgentId: null }]), [`agent-upgrade-denied:r1:${t.getTime()}`])
})
