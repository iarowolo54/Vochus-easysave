// Unit test: the agent's customer search forgives typos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesCustomer } from '../src/lib/fuzzy-search'

const ada = { firstName: 'Adaeze', lastName: 'Okonkwo', phone: '08031234567', customerId: 'CUS-0042' }
const hit = (q: string) => matchesCustomer(q.split(/\s+/), ada)

test('exact and partial names match', () => {
  assert.ok(hit('Adaeze')); assert.ok(hit('ada')); assert.ok(hit('adaeze okonkwo')); assert.ok(hit('okonkwo adaeze'))
})
test('typos match', () => {
  assert.ok(hit('Adeaze'))   // swapped letters
  assert.ok(hit('Adaze'))    // missing letter
  assert.ok(hit('Adaaeze'))  // extra letter
  assert.ok(hit('Okonkow'))  // swapped end
  assert.ok(hit('Okonqwo'))  // wrong letter
  assert.ok(hit('Okonq'))    // half-typed with a wrong letter
  assert.ok(!hit('a'.repeat(5000)))  // oversized word is skipped, not computed
})
test('phone with spaces or dashes matches', () => {
  assert.ok(hit('0803 123')); assert.ok(hit('0803-123-4567'))
})
test('unrelated names and short wrong words do not match', () => {
  assert.ok(!hit('Bola')); assert.ok(!hit('Chidi')); assert.ok(!hit('Adaeze Bello')); assert.ok(!hit('Abe'))
})
