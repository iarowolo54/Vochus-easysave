// Unit test: which paths the proxy refuses because they are temporary no-sign-in previews.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDevPreviewPath } from '../src/lib/dev-preview'

test('the preview pages and everything under them are blocked', () => {
  for (const p of ['/dev-preview', '/dev-preview/', '/dev-preview/admin', '/dev-preview/autofund/x']) assert.equal(isDevPreviewPath(p), true, p)
})

test('real pages are not blocked, including names that merely start the same way', () => {
  for (const p of ['/', '/dashboard', '/superadmin/commission', '/dev-preview-notes', '/api/customer/me']) assert.equal(isDevPreviewPath(p), false, p)
})
