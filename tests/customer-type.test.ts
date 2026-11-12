import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastPaidAtOf } from '../src/lib/customer-type'

test('lastPaidAtOf: null when empty, max ISO otherwise', () => {
  assert.equal(lastPaidAtOf([]), null)
  assert.equal(
    lastPaidAtOf([{ createdAt: new Date('2026-03-01') }, { createdAt: new Date('2026-01-01') }]),
    new Date('2026-03-01').toISOString(),
  )
  assert.equal(
    lastPaidAtOf([{ createdAt: new Date('2026-01-01') }, { createdAt: new Date('2026-03-01') }]),
    new Date('2026-03-01').toISOString(),
  )
})

import { asCustomerType, planSourceFor, planCreationBlock } from '../src/lib/customer-type'

test('asCustomerType: only the exact string online is online', () => {
  assert.equal(asCustomerType('online'), 'online')
  for (const v of ['offline', null, undefined, 'Online', 'x', 1]) assert.equal(asCustomerType(v), 'offline')
})

test('planSourceFor: online plans are self, offline plans are agent', () => {
  assert.equal(planSourceFor('online'), 'self')
  assert.equal(planSourceFor('offline'), 'agent')
})

test('planCreationBlock: refuses across the line, allows on the right side', () => {
  assert.equal(planCreationBlock('customer', 'offline'), 'Your plans are set up by your agent. Please ask them to open a new plan for you.')
  assert.equal(planCreationBlock('agent', 'online'), 'This customer saves on the app. They open their own plans.')
  assert.equal(planCreationBlock('customer', 'online'), null)
  assert.equal(planCreationBlock('agent', 'offline'), null)
})
