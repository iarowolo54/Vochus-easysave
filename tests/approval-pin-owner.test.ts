import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePinOwner } from '../src/lib/approval-pin'

test('staff role resolves to staff', () => {
  assert.equal(resolvePinOwner('staff'), 'staff')
})

for (const v of ['superadmin', undefined, null, '', 'agent', 1]) {
  test(`${String(v)} resolves to superadmin`, () => {
    assert.equal(resolvePinOwner(v), 'superadmin')
  })
}
