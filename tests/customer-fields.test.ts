import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NIGERIA_STATES, validateGender, validateState, validateLga } from '../src/lib/customer-fields'

test('there are 36 states + FCT', () => {
  assert.equal(NIGERIA_STATES.length, 37)
  assert.ok(NIGERIA_STATES.includes('Lagos'))
  assert.ok(NIGERIA_STATES.includes('FCT'))
})

test('gender accepts Female/Male only, and is required (#18)', () => {
  assert.deepEqual(validateGender('Female'), { ok: true, value: 'Female' })
  assert.deepEqual(validateGender('Male'), { ok: true, value: 'Male' })
  assert.equal(validateGender(undefined).ok, false)
  assert.equal(validateGender('male').ok, false) // case-sensitive
  assert.equal(validateGender('Other').ok, false)
})

test('state is REQUIRED and must be a real state', () => {
  assert.deepEqual(validateState('Kano'), { ok: true, value: 'Kano' })
  assert.equal(validateState(undefined).ok, false)
  assert.equal(validateState('').ok, false)
  assert.equal(validateState('Atlantis').ok, false)
})

test('LGA is REQUIRED and must belong to the chosen state', () => {
  assert.deepEqual(validateLga('Lagos', 'Ikeja'), { ok: true, value: 'Ikeja' })
  assert.equal(validateLga('Lagos', undefined).ok, false)
  assert.equal(validateLga('Lagos', '').ok, false)
  // Ikeja is in Lagos, NOT in Kano -> cross-state LGA is rejected.
  assert.equal(validateLga('Kano', 'Ikeja').ok, false)
  // A non-existent state has no LGAs, so any LGA fails.
  assert.equal(validateLga('Atlantis', 'Ikeja').ok, false)
})
