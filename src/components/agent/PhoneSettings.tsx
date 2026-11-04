'use client'
import { useCallback, useEffect, useState } from 'react'
import { FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { phoneSettingsMode, phoneState, type PhoneFlags } from '@/lib/phone-settings'

type Bridge = { postMessage: (s: string) => void }
type PhoneWindow = PhoneFlags & {
  __vochusDeviceId?: string
  VochusAppSettings?: Bridge
  VochusPrinterSetup?: Bridge
  VochusBiometric?: Bridge
  VochusBiometricClear?: Bridge
}
const win = () => window as unknown as PhoneWindow

/**
 * The printer and fingerprint controls, on the Settings page, for the agent Android app. A browser shows nothing. An older app that
 * only has the pop-up sheet gets one row that opens it. The newer app gets the real controls.
 */
export default function PhoneSettings() {
  const [flags, setFlags] = useState<PhoneFlags>({})
  const [busy, setBusy] = useState<'' | 'printer' | 'fingerprint'>('')
  const [error, setError] = useState('')

  const read = useCallback(() => { setFlags({ ...win() }); setBusy('') }, [])
  useEffect(() => {
    read()
    window.addEventListener('vochus:flags-ready', read)
    return () => window.removeEventListener('vochus:flags-ready', read)
  }, [read])

  const mode = phoneSettingsMode(flags)
  if (mode === 'none') return null
  const { printerName, fingerprintOn, canFingerprint } = phoneState(flags)

  // The app answers by announcing new flags. If it never does (the prompt was cancelled), stop waiting.
  function waitForApp(what: 'printer' | 'fingerprint') {
    setBusy(what)
    setTimeout(() => setBusy(b => (b === what ? '' : b)), 8000)
  }

  function printer(action: 'pick' | 'unlink') {
    setError('')
    waitForApp('printer')
    win().VochusPrinterSetup?.postMessage(action)
  }

  async function turnFingerprintOn() {
    setError('')
    waitForApp('fingerprint')
    try {
      const w = win()
      const res = await fetch('/api/auth/biometric/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }) })
      if (!res.ok) throw new Error()
      const d = await res.json() as { token: string; identifier: string }
      w.VochusBiometric?.postMessage(JSON.stringify({ token: d.token, identifier: d.identifier }))
    } catch {
      setBusy('')
      setError('Couldn’t turn on fingerprint sign-in. Check your connection and try again.')
    }
  }

  async function turnFingerprintOff() {
    setError('')
    waitForApp('fingerprint')
    try {
      const w = win()
      await fetch('/api/auth/biometric/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }) })
    } catch { /* the phone still forgets it below; the token is only useful from this phone */ }
    win().VochusBiometricClear?.postMessage('')
  }

  const heading = <div className="ui-section-head"><h2>This phone</h2></div>

  if (mode === 'legacy') {
    return (
      <>
        {heading}
        <section className="ui-card ui-card--list">
          <button type="button" className="ag-crow" onClick={() => win().VochusAppSettings?.postMessage('')}>
            <span className="ag-report-icon ag-set-icon" aria-hidden="true"><Icons.print size={18} /></span>
            <span className="ag-crow-main">
              <span className="ag-crow-name">Printer &amp; fingerprint</span>
              <span className="ag-crow-sub">Connect your Bluetooth printer and manage fingerprint sign-in</span>
            </span>
            <span className="ag-crow-end"><Icons.next size={18} aria-hidden="true" /></span>
          </button>
        </section>
      </>
    )
  }

  return (
    <>
      {heading}
      <section className="ui-card ui-card--list">
        <button type="button" className="ag-crow" disabled={busy === 'printer'} onClick={() => printer('pick')}>
          <span className={`ag-report-icon ${printerName ? 'ag-report-icon--ok' : 'ag-report-icon--open'}`} aria-hidden="true"><Icons.print size={18} /></span>
          <span className="ag-crow-main">
            <span className="ag-crow-name">Receipt printer</span>
            <span className="ag-crow-sub">{printerName ? `Connected to ${printerName}. Tap to choose another.` : 'Tap to pick your Bluetooth printer'}</span>
          </span>
          <span className="ag-crow-end"><span className={`ag-crow-tag ${printerName ? 'ag-crow-tag--ok' : 'ag-crow-tag--due'}`}>{printerName ? 'Connected' : 'Not set'}</span></span>
        </button>
        {printerName && (
          <button type="button" className="ag-crow" disabled={busy === 'printer'} onClick={() => printer('unlink')}>
            <span className="ag-report-icon ag-set-icon" aria-hidden="true"><Icons.close size={18} /></span>
            <span className="ag-crow-main">
              <span className="ag-crow-name">Remove printer</span>
              <span className="ag-crow-sub">Forget {printerName} on this phone</span>
            </span>
          </button>
        )}
        {canFingerprint && (
          <button type="button" className="ag-crow" disabled={busy === 'fingerprint'} onClick={fingerprintOn ? turnFingerprintOff : turnFingerprintOn}>
            <span className={`ag-report-icon ${fingerprintOn ? 'ag-report-icon--ok' : 'ag-report-icon--open'}`} aria-hidden="true"><Icons.fingerprint size={18} /></span>
            <span className="ag-crow-main">
              <span className="ag-crow-name">Fingerprint sign-in</span>
              <span className="ag-crow-sub">{fingerprintOn ? 'You can sign in on this phone with your fingerprint. Tap to turn off.' : 'Tap to sign in on this phone with your fingerprint'}</span>
            </span>
            <span className="ag-crow-end"><span className={`ag-crow-tag ${fingerprintOn ? 'ag-crow-tag--ok' : 'ag-crow-tag--due'}`}>{fingerprintOn ? 'On' : 'Off'}</span></span>
          </button>
        )}
        <FormError message={error} />
      </section>
    </>
  )
}
