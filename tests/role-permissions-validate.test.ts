import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRolePermissions } from '../src/lib/permissions'

test('valid areas pass', () => {
  assert.deepEqual(validateRolePermissions(['agents', 'money']), { ok: true, areas: ['agents', 'money'] })
})
test('dedupes', () => {
  assert.deepEqual(validateRolePermissions(['agents', 'agents']), { ok: true, areas: ['agents'] })
})
test('unknown string keys rejected and named', () => {
  assert.deepEqual(validateRolePermissions(['agents', 'bogus']), { ok: false, unknown: ['bogus'] })
})
test('non-array rejected', () => {
  for (const v of ['notarray', 42, {}, null, undefined]) {
    assert.deepEqual(validateRolePermissions(v), { ok: false, unknown: [] })
  }
})
test('non-string entry rejects whole input', () => {
  const r = validateRolePermissions(['agents', 5])
  assert.equal(r.ok, false)
})
test('empty array ok', () => {
  assert.deepEqual(validateRolePermissions([]), { ok: true, areas: [] })
})
