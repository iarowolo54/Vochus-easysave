// Unit test: how "Save receipt image" behaves in each place the web app can run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receiptSaveMode } from '../src/lib/receipt-image'

test('an app build with the save bridge hands the image to the app', () => {
  assert.equal(receiptSaveMode({ hasBridge: true, inApp: true }), 'bridge')
})

test('an app build without the bridge shows the image fitted to the screen, not as a raw full-size page', () => {
  assert.equal(receiptSaveMode({ hasBridge: false, inApp: true }), 'preview')
})

test('an ordinary browser downloads the file', () => {
  assert.equal(receiptSaveMode({ hasBridge: false, inApp: false }), 'download')
})
