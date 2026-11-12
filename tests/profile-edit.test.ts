import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_PROFILE_FIELDS, CUSTOMER_PROFILE_FIELDS, describeChanges, diffProfile, formValue } from '../src/lib/profile-edit'

const now = new Date(2026, 10, 12)
const customer = {
  firstName: 'Ada', lastName: 'Eze', gender: 'Female', dob: new Date(1990, 4, 6), phone: '08035551200', email: null,
  address: 'Oja Oba', state: 'Lagos', lga: 'Ikeja', nokName: 'Kemi', nokRelation: 'Sister', nokPhone: '08020000000',
}
const asCustomer = (body: unknown) => diffProfile(CUSTOMER_PROFILE_FIELDS, customer, body, { dobAs: 'date', now })

test('only changed fields are written, and untouched ones are left alone', () => {
  const r = asCustomer({ ...Object.fromEntries(Object.entries(customer).map(([k, v]) => [k, formValue(k === 'dob' ? 'dob' : 'text', v)])), firstName: '  Adaeze ' })
  assert.ok(r.ok)
  assert.deepEqual(r.data, { firstName: 'Adaeze' })
  assert.equal(r.signInChanged, false)
})

test('fields outside the list never reach the database', () => {
  const r = asCustomer({ walletBalance: 1e9, status: 'Active', agentId: 'x', bvn: '1', type: 'online' })
  assert.ok(r.ok)
  assert.deepEqual(r.data, {})
})

test('phones are normalised and must have 11 digits; a phone or email change needs the PIN', () => {
  const r = asCustomer({ phone: '+234 803 555 9999' })
  assert.ok(r.ok); assert.equal(r.data.phone, '08035559999'); assert.equal(r.signInChanged, true)
  assert.deepEqual(asCustomer({ phone: '0803555' }), { ok: false, error: 'Phone number: phone numbers have 11 digits.' })
  const e = asCustomer({ email: ' Ada@Example.COM ' })
  assert.ok(e.ok); assert.equal(e.data.email, 'ada@example.com'); assert.equal(e.signInChanged, true)
  assert.equal(asCustomer({ email: 'not-an-email' }).ok, false)
})

test('required fields can’t be emptied, optional ones can', () => {
  assert.deepEqual(asCustomer({ address: '  ' }), { ok: false, error: 'Home address can’t be empty.' })
  const r = diffProfile(CUSTOMER_PROFILE_FIELDS, { ...customer, email: 'a@b.co' }, { email: '' }, { dobAs: 'date', now })
  assert.ok(r.ok); assert.equal(r.data.email, null)
})

test('changing the state requires a local government in the new state', () => {
  assert.equal(asCustomer({ state: 'Oyo' }).ok, false)
  const r = asCustomer({ state: 'Oyo', lga: 'Ibadan North' })
  assert.ok(r.ok); assert.deepEqual(r.data, { state: 'Oyo', lga: 'Ibadan North' })
  assert.equal(asCustomer({ lga: 'Ibadan North' }).ok, false)
})

test('dates of birth are checked and stored the way each table keeps them', () => {
  const c = asCustomer({ dob: '1991-02-03' })
  assert.ok(c.ok); assert.ok(c.data.dob instanceof Date)
  assert.equal(asCustomer({ dob: '2031-02-03' }).ok, false)
  const a = diffProfile(AGENT_PROFILE_FIELDS, { name: 'A', phone: '08000000001', location: 'Lagos', dob: null }, { dob: '1985-07-01' }, { dobAs: 'text', now })
  assert.ok(a.ok); assert.equal(a.data.dob, '1985-07-01')
})

test('older records missing a required value still save other changes', () => {
  const r = diffProfile(CUSTOMER_PROFILE_FIELDS, { ...customer, state: null, lga: null, gender: null }, { firstName: 'Ada', nokName: 'Kemi A' }, { dobAs: 'date', now })
  assert.ok(r.ok); assert.deepEqual(r.data, { nokName: 'Kemi A' })
})

test('the audit line names each change', () => {
  const r = asCustomer({ phone: '08035559999', email: 'ada@example.com' })
  assert.ok(r.ok)
  assert.equal(describeChanges(r.changes), 'Phone number 08035551200 → 08035559999; Email (none) → ada@example.com')
})
