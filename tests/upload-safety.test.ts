// Unit test: what may be stored as an uploaded document, and how anything stored gets served.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectType, safeFileName, serveStoredFile, validateUpload, MAX_UPLOAD_BYTES } from '../src/lib/upload-safety'

const b64 = (s: string | number[]) => Buffer.from(s as never).toString('base64')
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16]
const WEBP = 'RIFF\x1e\0\0\0WEBPVP8 '
const PDF = '%PDF-1.7\n'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
const HTML = '<html><script>alert(1)</script></html>'
const url = (mime: string, body: string | number[]) => `data:${mime};base64,${b64(body)}`

test('detectType reads the bytes, not the label', () => {
  assert.equal(detectType(Buffer.from(PNG)), 'image/png')
  assert.equal(detectType(Buffer.from(JPEG)), 'image/jpeg')
  assert.equal(detectType(Buffer.from(WEBP)), 'image/webp')
  assert.equal(detectType(Buffer.from(PDF)), 'application/pdf')
  assert.equal(detectType(Buffer.from(SVG)), null)
  assert.equal(detectType(Buffer.from('RIFF\0\0\0\0WAVE')), null)
  assert.equal(detectType(Buffer.alloc(0)), null)
})

for (const [mime, body, name] of [
  ['image/png', PNG, 'a.png'], ['image/jpeg', JPEG, 'a.jpg'], ['image/jpg', JPEG, 'a.jpg'], ['image/webp', WEBP, 'a.webp'], ['application/pdf', PDF, 'a.pdf'],
] as const) {
  test(`validateUpload accepts ${mime}`, () => {
    const r = validateUpload(name, url(mime, body as string | number[]))
    assert.equal(r.ok, true)
  })
}

test('validateUpload: a phone that reports no type is judged by the bytes, and the real type is stored', () => {
  for (const mime of ['', 'application/octet-stream']) {
    const r = validateUpload('photo.jpg', url(mime, JPEG))
    assert.equal(r.ok, true, mime)
    assert.ok(r.ok && r.fileData.startsWith('data:image/jpeg;base64,'))
    assert.equal(validateUpload('x.html', url(mime, HTML)).ok, false)
  }
})

test('validateUpload refuses SVG and HTML, even labelled as something allowed', () => {
  for (const data of [url('image/svg+xml', SVG), url('text/html', HTML), url('image/png', SVG), url('application/pdf', HTML), url('image/png', HTML)]) {
    const r = validateUpload('x.png', data)
    assert.equal(r.ok, false, data.slice(0, 30))
    if (!r.ok) assert.match(r.error, /JPEG, PNG, WebP or PDF/)
  }
})

test('validateUpload refuses bytes that are a different allowed type from the label', () => {
  assert.equal(validateUpload('x.png', url('image/png', PDF)).ok, false)
})

test('validateUpload refuses a non-data value, a remote URL and bad base64', () => {
  for (const data of ['hello', 'https://evil.test/x.png', 'data:image/png;base64,@@@', 'data:image/png,abc', '', 42, null]) {
    assert.equal(validateUpload('x.png', data).ok, false)
  }
})

test('validateUpload refuses anything over the size cap, with a readable message', () => {
  const big = `data:image/png;base64,${Buffer.alloc(MAX_UPLOAD_BYTES + 3).fill(0x41).toString('base64')}`
  const r = validateUpload('x.png', big)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /5 MB/)
})

test('safeFileName: strips paths and control characters, and the extension follows the real type', () => {
  assert.equal(safeFileName('../../etc/passwd', 'image/png'), 'passwd.png')
  assert.equal(safeFileName('C:\\Users\\me\\scan.PDF', 'application/pdf'), 'scan.pdf')
  assert.equal(safeFileName('evil.html', 'image/jpeg'), 'evil.jpg')
  assert.equal(safeFileName('a"b\r\nc.jpg', 'image/jpeg'), 'a_b__c.jpg')
  assert.equal(safeFileName('Àṣàkẹ́.pdf', 'application/pdf'), 'Àṣàkẹ́.pdf')
  assert.equal(safeFileName('', 'image/png'), 'document.png')
  assert.ok(safeFileName(`${'x'.repeat(500)}.png`, 'image/png').length <= 120)
})

test('validateUpload returns the safe name to store', () => {
  const r = validateUpload('evil.svg', url('image/png', PNG))
  assert.equal(r.ok && r.fileName, 'evil.png')
  assert.equal(validateUpload(123, url('image/png', PNG)).ok, false)
})

test('serveStoredFile: good rows open inline with their type', () => {
  for (const [mime, body] of [['image/png', PNG], ['image/jpeg', JPEG], ['application/pdf', PDF]] as const) {
    const s = serveStoredFile(url(mime, body as string | number[]), 'x')
    assert.equal(s.contentType, mime)
    assert.equal(s.inline, true)
  }
})

test('serveStoredFile: stored script comes back as a harmless attachment', () => {
  for (const data of [url('text/html', HTML), url('image/svg+xml', SVG), url('image/png', HTML), url('application/pdf', SVG), b64(HTML), 'not base64 at all']) {
    const s = serveStoredFile(data, 'x.html')
    assert.equal(s.contentType, 'application/octet-stream', data.slice(0, 30))
    assert.equal(s.inline, false)
  }
})

test('serveStoredFile: an old PDF stored without a type still opens, from its bytes and its name', () => {
  const s = serveStoredFile(url('application/octet-stream', PDF), 'form.pdf')
  assert.equal(s.contentType, 'application/pdf')
  assert.equal(s.inline, true)
  assert.equal(serveStoredFile(url('application/octet-stream', HTML), 'form.pdf').inline, false)
})
