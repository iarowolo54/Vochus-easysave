// Unit test: what a chat bubble may render as an image link. Old rows were stored unchecked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isChatImage } from '../src/lib/chat-image'

test('allowed picture data URLs render', () => {
  for (const t of ['png', 'jpeg', 'jpg', 'webp']) assert.equal(isChatImage(`data:image/${t};base64,AAAA`), true)
})

test('anything else does not', () => {
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'https://evil.test/a.png', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', ' data:image/png;base64,AAAA', '', null, undefined]) {
    assert.equal(isChatImage(bad), false, String(bad))
  }
})
