//   NEXTAUTH_SECRET=test npx tsx --test tests/payout-mode.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePayoutMode } from '../src/lib/payout-mode'

test('null (no stored setting) resolves both channels to auto', () => {
  assert.deepEqual(parsePayoutMode(null), { agent: 'auto', customer: 'auto' })
})

test('malformed JSON is tolerated and resolves both channels to auto', () => {
  assert.deepEqual(parsePayoutMode('not json{'), { agent: 'auto', customer: 'auto' })
})

test('only the manual value flips a channel', () => {
  assert.deepEqual(
    parsePayoutMode('{"agent":"manual","customer":"auto"}'),
    { agent: 'manual', customer: 'auto' },
  )
})

test('unknown, missing, or wrong-typed channel values fall back to auto', () => {
  assert.deepEqual(parsePayoutMode('{"agent":"bogus"}'), { agent: 'auto', customer: 'auto' })
  assert.deepEqual(parsePayoutMode('{"customer":true}'), { agent: 'auto', customer: 'auto' })
  assert.deepEqual(parsePayoutMode('{"agent":"MANUAL"}'), { agent: 'auto', customer: 'auto' })
})
