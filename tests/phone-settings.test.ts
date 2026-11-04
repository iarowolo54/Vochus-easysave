// Unit test: what the agent screens show for the phone's printer and fingerprint, depending on the app build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneSettingsMode, phoneState, readPhoneFlags, shouldAutoEnrollFingerprint } from '../src/lib/phone-settings'

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

test('readPhoneFlags copies only the flags the screens use', () => {
  const w = { ...NEW_APP, __vochusDeviceId: 'dev-1', somethingElse: 1, document: {} }
  assert.deepEqual(readPhoneFlags(w), { ...NEW_APP })
})

test('readPhoneFlags never touches the rest of the browser window, so a getter that throws cannot break the page', () => {
  const w = { ...NEW_APP } as Record<string, unknown>
  Object.defineProperty(w, 'localStorage', { enumerable: true, get() { throw new Error('SecurityError: storage is blocked') } })
  assert.doesNotThrow(() => readPhoneFlags(w))
  assert.equal(readPhoneFlags(w).__vochusApp, 'agent')
})

test('readPhoneFlags leaves out flags the app did not set', () => {
  assert.deepEqual(readPhoneFlags({ __vochusApp: 'agent' }), { __vochusApp: 'agent' })
  assert.deepEqual(readPhoneFlags({}), {})
})
