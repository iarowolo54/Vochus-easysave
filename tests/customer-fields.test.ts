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

test('date of birth is REQUIRED, real, not in the future, and at most 120 years ago', async () => {
  const { validateDob, ageOn } = await import('../src/lib/customer-fields')
  const now = new Date(2026, 10, 12) // 12 Nov 2026
  const ok = validateDob('1990-05-01', now)
  assert.ok(ok.ok)
  if (ok.ok) assert.equal(ok.value.getTime(), new Date(1990, 4, 1).getTime())
  assert.ok(validateDob('2026-11-12', now).ok) // today is allowed
  for (const bad of [undefined, null, '', '1990-5-1', '01/05/1990', 19900501]) assert.equal(validateDob(bad, now).ok, false)
  assert.equal(validateDob('1990-02-31', now).ok, false) // no such day
  assert.equal(validateDob('2026-11-13', now).ok, false) // tomorrow
  assert.ok(validateDob('1905-11-13', now).ok)            // 120, turning 121 tomorrow
  assert.equal(validateDob('1905-11-12', now).ok, false)  // 121 today
  assert.equal(ageOn(new Date(1990, 10, 12), now), 36)    // birthday today
  assert.equal(ageOn(new Date(1990, 10, 13), now), 35)    // birthday tomorrow
})
