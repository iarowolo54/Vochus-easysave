// Unit test: what the agent screens show for the phone's printer and fingerprint, depending on the app build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneSettingsMode, phoneState, shouldAutoEnrollFingerprint } from '../src/lib/phone-settings'

const NEW_APP = { __vochusApp: 'agent', __vochusCanManagePhone: true, __vochusCanOpenSettings: true, __vochusCanBiometric: true, __vochusBiometricEnrolled: false, __vochusPrinterName: '' }
const OLD_APP = { __vochusApp: 'agent', __vochusCanOpenSettings: true, __vochusCanBiometric: true, __vochusBiometricEnrolled: false }

test('the new agent app manages the printer and fingerprint on the Settings page', () => {
  assert.equal(phoneSettingsMode(NEW_APP), 'manage')
})

test('an older agent app still uses the pop-up sheet', () => {
  assert.equal(phoneSettingsMode(OLD_APP), 'legacy')
})

test('a browser, or the customer app, shows nothing', () => {
  assert.equal(phoneSettingsMode({}), 'none')
  assert.equal(phoneSettingsMode({ __vochusApp: 'customer', __vochusCanManagePhone: true }), 'none')
})

test('phoneState reads the printer name and the fingerprint switch', () => {
  assert.deepEqual(phoneState({ ...NEW_APP, __vochusPrinterName: 'RPP02N', __vochusBiometricEnrolled: true }), { printerName: 'RPP02N', fingerprintOn: true, canFingerprint: true })
  assert.deepEqual(phoneState(NEW_APP), { printerName: null, fingerprintOn: false, canFingerprint: true })
})

test('fingerprint only turns itself on in an older app; the new app waits for the Enable button', () => {
  assert.equal(shouldAutoEnrollFingerprint(OLD_APP), true)
  assert.equal(shouldAutoEnrollFingerprint(NEW_APP), false)
  assert.equal(shouldAutoEnrollFingerprint({ ...OLD_APP, __vochusBiometricEnrolled: true }), false)
  assert.equal(shouldAutoEnrollFingerprint({}), false)
})
