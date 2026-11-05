import test from 'node:test'
import assert from 'node:assert/strict'
import { alertEmailFor } from '../src/lib/email-alerts'

const when = new Date()
test('alerts go only to a confirmed address with alerts on', () => {
  assert.equal(alertEmailFor({ email: 'a@b.co', emailVerifiedAt: when, emailAlertsOn: true }), 'a@b.co')
  assert.equal(alertEmailFor({ email: ' a@b.co ', emailVerifiedAt: when, emailAlertsOn: true }), 'a@b.co')
})
test('no alert when unconfirmed, switched off, or no email', () => {
  assert.equal(alertEmailFor({ email: 'a@b.co', emailVerifiedAt: null, emailAlertsOn: true }), null)
  assert.equal(alertEmailFor({ email: 'a@b.co', emailVerifiedAt: when, emailAlertsOn: false }), null)
  assert.equal(alertEmailFor({ email: null, emailVerifiedAt: when, emailAlertsOn: true }), null)
  assert.equal(alertEmailFor({ email: '  ', emailVerifiedAt: when, emailAlertsOn: true }), null)
})

import { agentAlertEmailFor } from '../src/lib/email-alerts'
test('agent alerts need a verified email and the switch on', () => {
  assert.equal(agentAlertEmailFor({ email: 'a@b.co', emailVerified: true, emailAlertsOn: true }), 'a@b.co')
  assert.equal(agentAlertEmailFor({ email: 'a@b.co', emailVerified: false, emailAlertsOn: true }), null)
  assert.equal(agentAlertEmailFor({ email: 'a@b.co', emailVerified: true, emailAlertsOn: false }), null)
  assert.equal(agentAlertEmailFor({ email: null, emailVerified: true, emailAlertsOn: true }), null)
})
