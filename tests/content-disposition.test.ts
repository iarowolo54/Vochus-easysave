// Unit test: a stored filename must never break the response header, or smuggle anything into it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contentDisposition } from '../src/lib/content-disposition'

// Headers throws on anything a header can't carry, which is what gave the admin a 500.
const usable = (v: string) => new Headers({ 'Content-Disposition': v }).get('Content-Disposition')

test('a plain name is unchanged in both forms', () => {
  assert.equal(contentDisposition('inline', 'nin.pdf'), `inline; filename="nin.pdf"; filename*=UTF-8''nin.pdf`)
})

test('a Yoruba name stays usable: an ASCII fallback plus the real name encoded', () => {
  const v = contentDisposition('inline', 'Àṣàkẹ́ ID.pdf')
  assert.ok(usable(v))
  assert.match(v, /filename="[\x20-\x7e]*\.pdf"/)
  assert.match(v, /filename\*=UTF-8''.*%E1%B9%A3/)
})

test('quotes, backslashes and line breaks cannot escape the header', () => {
  const v = contentDisposition('attachment', 'a"; evil=1\\b\r\nX-Hack: 1.pdf')
  assert.ok(usable(v))
  assert.doesNotMatch(v, /[\r\n]/)
  assert.equal(v.split('; filename="')[1].split('"')[0].includes('"'), false)
})

test('the encoded form leaves no raw characters RFC 5987 forbids', () => {
  assert.match(contentDisposition('inline', "it's (1)*.pdf"), /filename\*=UTF-8''it%27s%20%281%29%2A\.pdf$/)
})

test('a broken surrogate or an empty name still gives a usable header', () => {
  assert.ok(usable(contentDisposition('inline', 'a\ud800b.pdf')))
  assert.match(contentDisposition('inline', ''), /filename="document"/)
})
