// Unit tests for server-side, crypto-random MemberCard serial generation.
// The old scheme embedded a weak Math.random batch id and numbered serials
// sequentially (VES-<bid>0001, 0002, …), so one known serial exposed the whole
// batch. Serials must now be independent and unguessable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { genBatchId, genSerial, generateUniqueSerials, SERIAL_RE } from '../src/lib/member-card'

test('a serial is VES- plus high-entropy hex, not sequential', () => {
  const s = genSerial()
  assert.match(s, SERIAL_RE)
  assert.notEqual(genSerial(), genSerial()) // independent, not a counter
})

test('a batch id is unguessable hex', () => {
  assert.match(genBatchId(), /^[0-9A-F]{8}$/)
  assert.notEqual(genBatchId(), genBatchId())
})

test('generateUniqueSerials returns the exact count, all unique and well-formed', () => {
  const n = 500
  const serials = generateUniqueSerials(n)
  assert.equal(serials.length, n)
  assert.equal(new Set(serials).size, n, 'no duplicates')
  for (const s of serials) assert.match(s, SERIAL_RE)
})

test('serials do not share a guessable common prefix beyond the brand tag', () => {
  const serials = generateUniqueSerials(50)
  const bodies = serials.map(s => s.slice(4)) // strip "VES-"
  // The random bodies should almost never share a leading char across all 50.
  const firstChars = new Set(bodies.map(b => b[0]))
  assert.ok(firstChars.size > 1, 'random bodies must not all start the same')
})
