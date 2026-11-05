//   npx tsx --test tests/transfer-intent.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickUniqueKobo, matchAlertToIntent, canReuse, TRANSFER_WINDOW_MS, TRANSFER_GRACE_MS } from '../src/lib/transfer-intent'

test('pickUniqueKobo takes the first free kobo from .10', () => {
  assert.equal(pickUniqueKobo(13000, []), 13000.1)
  assert.equal(pickUniqueKobo(13000, [13000.1, 13000.11]), 13000.12)
})

test('pickUniqueKobo ignores taken amounts of other bases', () => {
  assert.equal(pickUniqueKobo(500, [13000.1]), 500.1)
})

test('pickUniqueKobo returns null when all 90 are taken', () => {
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

const future = new Date(Date.now() + 60_000)
test('canReuse: same plan, same base amount, still open', () => {
  assert.equal(canReuse({ amount: 13000.37, planId: 'P', expiresAt: future }, 'P', 13000), true)
})

test('canReuse works for a base amount that has kobo, and for the same days only', () => {
  assert.equal(canReuse({ amount: 4285.72, planId: 'P', expiresAt: future, coversKeys: '["d1","d2"]' }, 'P', 4285.71, ['d2', 'd1']), true)
  assert.equal(canReuse({ amount: 4285.72, planId: 'P', expiresAt: future, coversKeys: '["d1","d2"]' }, 'P', 4285.71, ['d1']), false)
  assert.equal(canReuse({ amount: 4285.72, planId: 'P', expiresAt: future, coversKeys: null }, 'P', 4285.71, ['d1']), false)
  assert.equal(canReuse({ amount: 13000, planId: 'P', expiresAt: future }, 'P', 13000), false) // no kobo added: not one of ours
})

test('canReuse: different plan, different amount or an expired intent is not reused', () => {
  assert.equal(canReuse({ amount: 13000.37, planId: 'Q', expiresAt: future }, 'P', 13000), false)
  assert.equal(canReuse({ amount: 13000.37, planId: 'P', expiresAt: future }, 'P', 12000), false)
  assert.equal(canReuse({ amount: 13000.37, planId: 'P', expiresAt: new Date(Date.now() - 1) }, 'P', 13000), false)
})
