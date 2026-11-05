//   npx tsx --test tests/transfer-figure.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameFigure, nearAmount } from '../src/lib/transfer-figure'

test('a rounded payment is the same figure as the amount shown, down or up', () => {
  assert.equal(sameFigure(1000.37, 1000), true)
  assert.equal(sameFigure(1000.37, 1000.37), true)
  assert.equal(sameFigure(1000.99, 1001), true) // round-up payment
  assert.equal(sameFigure(1000.01, 999.5), true)
})

test('a whole naira or more apart is a different figure', () => {
  assert.equal(sameFigure(1000, 1001), false)
  assert.equal(sameFigure(1000.37, 1001.37), false)
  assert.equal(sameFigure(500, 1000), false)
})

test('nearAmount is the same test as a range', () => {
  const r = nearAmount(1000.37)
  assert.ok(1000 > r.gt && 1000 < r.lt)
  assert.ok(1001 > r.gt && 1001 < r.lt)
  assert.ok(!(1001.37 < r.lt))
})
