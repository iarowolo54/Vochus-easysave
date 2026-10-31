import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldPing } from '../src/components/SessionKeepAlive'

const GAP = 90_000

test('shouldPing: no previous ping -> true', () => {
  assert.equal(shouldPing(null, 1_000, GAP), true)
})
test('shouldPing: gap exactly minGap -> true', () => {
  assert.equal(shouldPing(1_000, 1_000 + GAP, GAP), true)
})
test('shouldPing: gap below minGap -> false', () => {
  assert.equal(shouldPing(1_000, 1_000 + GAP - 1, GAP), false)
})
test('shouldPing: gap above minGap -> true', () => {
  assert.equal(shouldPing(1_000, 1_000 + GAP + 1, GAP), true)
})
