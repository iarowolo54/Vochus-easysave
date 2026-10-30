import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customerType, lastPaidAtOf } from '../src/lib/customer-type'

test('customerType: any self plan is online', () => {
  assert.equal(customerType([{ source: 'self' }]), 'online')
  assert.equal(customerType([{ source: 'agent' }, { source: 'self' }]), 'online')
})

test('customerType: otherwise offline', () => {
  assert.equal(customerType([{ source: 'agent' }]), 'offline')
  assert.equal(customerType([]), 'offline')
})

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
