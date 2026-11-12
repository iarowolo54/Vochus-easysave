import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPopupQueue } from '../src/lib/popup-slot'

const tick = () => new Promise(r => setTimeout(r, 0))

test('the second pop-up waits until the first is closed', async () => {
  const take = createPopupQueue()
  const order: string[] = []
  const a = take().then(release => { order.push('a open'); return release })
  const b = take().then(release => { order.push('b open'); return release })
  const releaseA = await a
  await tick()
  assert.deepEqual(order, ['a open'])
  releaseA()
  const releaseB = await b
  assert.deepEqual(order, ['a open', 'b open'])
  releaseB()
})

test('releasing twice does not let a third one jump ahead', async () => {
  const take = createPopupQueue()
  const releaseA = await take()
  const b = take()
  const c = take()
  let cOpen = false
  void c.then(() => { cOpen = true })
  releaseA(); releaseA()
  const releaseB = await b
  await tick()
  assert.equal(cOpen, false)
  releaseB()
  await c
  assert.equal(cOpen, true)
})
