// Unit tests for the client send flow behind "Send to customer".
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createReceiptSender, postReceipt, SEND_IDLE, type SendStatus } from '../src/lib/receipt-send'

const SENT: SendStatus = { state: 'sent', error: '', canOpenChat: true }

function deferred() {
  let resolve!: (s: SendStatus) => void
  const promise = new Promise<SendStatus>(r => { resolve = r })
  return { promise, resolve }
}
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const respond = (status: number, body: unknown) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch }

test('send reports sending, then the result', async () => {
  const seen: SendStatus[] = []
  await createReceiptSender(s => seen.push(s), async () => SENT).send(['a'])
  assert.deepEqual(seen.map(s => s.state), ['sending', 'sent'])
})

test('a slow result is ignored after reset, so it cannot mark the next receipt as sent', async () => {
  const seen: SendStatus[] = []
  const slow = deferred()
  const sender = createReceiptSender(s => seen.push(s), () => slow.promise)
  const sending = sender.send(['first'])
  sender.reset()
  slow.resolve(SENT)
  await sending
  assert.deepEqual(seen.at(-1), SEND_IDLE)
})

test('a slow result is ignored once a newer send has started', async () => {
  const seen: SendStatus[] = []
  const first = deferred()
  const second = deferred()
  const queue = [first, second]
  const sender = createReceiptSender(s => seen.push(s), () => queue.shift()!.promise)
  const a = sender.send(['first'])
  const b = sender.send(['second'])
  first.resolve({ ...SEND_IDLE, error: 'old failure' })
  await a
  assert.equal(seen.at(-1)?.state, 'sending')
  second.resolve(SENT)
  await b
  assert.equal(seen.at(-1)?.state, 'sent')
})

test('postReceipt passes canOpenChat through, defaulting to true', async () => {
  respond(200, { sent: true, canOpenChat: false })
  assert.deepEqual(await postReceipt(['a']), { state: 'sent', error: '', canOpenChat: false })
  respond(200, { sent: true })
  assert.equal((await postReceipt(['a'])).canOpenChat, true)
})

test('postReceipt shows the server error, such as a refused payout', async () => {
  respond(409, { error: 'This bank payout failed, so the receipt can’t be sent.' })
  assert.deepEqual(await postReceipt(['a']), { ...SEND_IDLE, error: 'This bank payout failed, so the receipt can’t be sent.' })
})

test('postReceipt returns to idle with an error on a lost connection or an unreadable reply', async () => {
  globalThis.fetch = (async () => { throw new TypeError('offline') }) as typeof fetch
  assert.match((await postReceipt(['a'])).error, /No connection/)
  globalThis.fetch = (async () => new Response('<html>', { status: 500 })) as typeof fetch
  const bad = await postReceipt(['a'])
  assert.equal(bad.state, 'idle')
  assert.match(bad.error, /could not be sent/)
})
