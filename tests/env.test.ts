import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireEnv } from '../src/lib/env'

test('requireEnv returns the value when set', () => {
  process.env.__TEST_SEC = 'abc'
  assert.equal(requireEnv('__TEST_SEC'), 'abc')
  delete process.env.__TEST_SEC
})

test('requireEnv fails closed when the var is missing or empty', () => {
  delete process.env.__TEST_MISSING
  assert.throws(() => requireEnv('__TEST_MISSING'), /Missing required environment variable: __TEST_MISSING/)
  process.env.__TEST_EMPTY = ''
  assert.throws(() => requireEnv('__TEST_EMPTY'), /Missing required/)
  delete process.env.__TEST_EMPTY
})
