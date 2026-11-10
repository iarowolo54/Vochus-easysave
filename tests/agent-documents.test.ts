import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentDocLabel, canStoreAgentDoc, parseRequiredDocs, statusAfterStaffUpload } from '../src/lib/agent-documents'

test('an approved document stays approved when staff replace it', () => {
  assert.equal(statusAfterStaffUpload('approved'), 'approved')
})

test('anything not approved goes for review, so an upload cannot skip approval', () => {
  for (const previous of ['pending', 'rejected', null, undefined, '']) assert.equal(statusAfterStaffUpload(previous), 'pending')
})

test('required documents survive bad data', () => {
  assert.deepEqual(parseRequiredDocs('["id","addr"]'), ['id', 'addr'])
  assert.deepEqual(parseRequiredDocs('[1,"id",null]'), ['id'])
  for (const raw of [null, undefined, '', 'not json', '{"a":1}']) assert.deepEqual(parseRequiredDocs(raw), [])
})

test('staff can store standard, required or existing documents and nothing else', () => {
  assert.equal(canStoreAgentDoc('bank', [], false), true)
  assert.equal(canStoreAgentDoc('custom', ['custom'], false), true)
  assert.equal(canStoreAgentDoc('legacy', [], true), true)
  assert.equal(canStoreAgentDoc('../evil', [], false), false)
})

test('labels fall back to the stored type', () => {
  assert.equal(agentDocLabel('addr'), 'Proof of address')
  assert.equal(agentDocLabel('custom'), 'custom')
})
