import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NIGERIA_STATES, validateGender, validateState } from '../src/lib/customer-fields'

test('there are 36 states + FCT', () => {
  assert.equal(NIGERIA_STATES.length, 37)
  assert.ok(NIGERIA_STATES.includes('Lagos'))
  assert.ok(NIGERIA_STATES.includes('FCT'))
})

test('gender accepts Female/Male only, and is required (#18)', () => {
  assert.deepEqual(validateGender('Female'), { ok: true, value: 'Female' })
  assert.deepEqual(validateGender('Male'), { ok: true, value: 'Male' })
  assert.equal(validateGender(undefined).ok, false)
  assert.equal(validateGender('').ok, false)
  assert.equal(validateGender('male').ok, false) // case-sensitive per spec
  assert.equal(validateGender('Other').ok, false)
  assert.equal(validateGender(1 as unknown).ok, false)
})

test('state is optional but must be a real state when given', () => {
  assert.deepEqual(validateState(undefined), { ok: true, value: null })
  assert.deepEqual(validateState(''), { ok: true, value: null })
  assert.deepEqual(validateState('Kano'), { ok: true, value: 'Kano' })
  assert.equal(validateState('Atlantis').ok, false)
  assert.equal(validateState(42 as unknown).ok, false)
})
