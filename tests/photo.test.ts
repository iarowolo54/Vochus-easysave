// Unit tests for the interim enrolment-photo guard (#8).
// NB: this is NOT a liveness check — "camera only" can't be proven server-side.
// It only rejects non-image / malformed / oversized payloads from a direct API call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePhoto } from '../src/lib/photo'

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('a missing/empty photo is allowed (optional)', () => {
  assert.equal(validatePhoto(undefined).ok, true)
  assert.equal(validatePhoto(null).ok, true)
  assert.equal(validatePhoto('').ok, true)
})

test('a valid png/jpeg/webp data URL is accepted', () => {
  assert.equal(validatePhoto(tinyPng).ok, true)
  assert.equal(validatePhoto('data:image/jpeg;base64,/9j/4AAQSkZJRg==').ok, true)
  assert.equal(validatePhoto('data:image/webp;base64,UklGRh4AAABXRUJQ').ok, true)
})

test('a non-string is rejected', () => {
  assert.equal(validatePhoto({ foo: 1 }).ok, false)
  assert.equal(validatePhoto(123).ok, false)
})

test('a non-image or non-data-URL is rejected', () => {
  assert.equal(validatePhoto('https://evil.example/x.png').ok, false)
  assert.equal(validatePhoto('data:application/pdf;base64,JVBERi0=').ok, false)
  assert.equal(validatePhoto('data:text/html;base64,PHNjcmlwdD4=').ok, false)
  assert.equal(validatePhoto('just a string').ok, false)
})

test('invalid base64 payload is rejected', () => {
  assert.equal(validatePhoto('data:image/png;base64,not*valid*base64!!').ok, false)
})

test('an oversized photo is rejected', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024) // ~6MB decoded
  assert.equal(validatePhoto(huge).ok, false)
})
