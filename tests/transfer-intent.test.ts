//   npx tsx --test tests/transfer-intent.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickUniqueKobo, matchAlertToIntent, TRANSFER_WINDOW_MS, TRANSFER_GRACE_MS } from '../src/lib/transfer-intent'

test('pickUniqueKobo takes the first free kobo from .01', () => {
  assert.equal(pickUniqueKobo(13000, []), 13000.01)
  assert.equal(pickUniqueKobo(13000, [13000.01, 13000.02]), 13000.03)
})

test('pickUniqueKobo ignores taken amounts of other bases', () => {
  assert.equal(pickUniqueKobo(500, [13000.01]), 500.01)
})

test('pickUniqueKobo returns null when all 99 are taken', () => {
  const taken = Array.from({ length: 99 }, (_, i) => Number((13000 + (i + 1) / 100).toFixed(2)))
  assert.equal(pickUniqueKobo(13000, taken), null)
})

const t0 = new Date('2026-11-04T10:00:00Z')
const intent = (ref: string, amount: number, createdAt = t0) =>
  ({ ref, amount, createdAt, expiresAt: new Date(createdAt.getTime() + TRANSFER_WINDOW_MS) })
const at = (ms: number) => new Date(t0.getTime() + ms)

test('matches the one open intent with the exact amount inside the window', () => {
  const i = intent('A', 13000.37)
  assert.equal(matchAlertToIntent({ amount: 13000.37, at: at(60_000) }, [i, intent('B', 500.01)]), i)
})

test('a transfer a little after expiry still matches (grace), later does not', () => {
  const i = intent('A', 13000.37)
  assert.equal(matchAlertToIntent({ amount: 13000.37, at: at(TRANSFER_WINDOW_MS + TRANSFER_GRACE_MS - 1) }, [i]), i)
  assert.equal(matchAlertToIntent({ amount: 13000.37, at: at(TRANSFER_WINDOW_MS + TRANSFER_GRACE_MS + 1) }, [i]), 'none')
})

test('a transfer before the intent existed does not match', () => {
  assert.equal(matchAlertToIntent({ amount: 13000.37, at: at(-1000) }, [intent('A', 13000.37)]), 'none')
})

test('wrong amount does not match', () => {
  assert.equal(matchAlertToIntent({ amount: 13000, at: at(1000) }, [intent('A', 13000.37)]), 'none')
})

test('two intents with the same amount are ambiguous', () => {
  assert.equal(matchAlertToIntent({ amount: 500.01, at: at(1000) }, [intent('A', 500.01), intent('B', 500.01)]), 'ambiguous')
})
