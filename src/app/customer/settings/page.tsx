'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import Logo from '@/components/Logo'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import BottomSheet from '@/components/ui/BottomSheet'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import EmptyState from '@/components/ui/EmptyState'
import { FormSkeleton } from '@/components/ui/Skeleton'
import ListRow from '@/components/ui/ListRow'
import { Icons } from '@/components/ui/icons'
import Toast from '@/components/ui/Toast'
import EmailAlertsSheet from '@/components/customer/EmailAlertsSheet'
import { biometricState, disableBiometric, enableBiometric } from '@/lib/app-biometric'
import { displayName } from '@/lib/format'
import { getHideBalance, getTextSize, setHideBalance, setTextSize, type TextSize } from '@/lib/preferences'

type CustomerData = { customerId: string; name: string; phone: string; email: string | null; emailVerified?: boolean; emailAlertsOn?: boolean; photoUrl: string | null }

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}</label>
        {children}
      </div>
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  )
}

export default function CustomerSettingsPage() {
  const router = useRouter()
  const { data, loading, failed, reload } = useCustomerMe<CustomerData>()
  const [textSize, setSize] = useState<TextSize>('normal')
  const [hideBalance, setHide] = useState(false)
  const [bio, setBio] = useState({ canManage: false, enrolled: false })
  const [bioBusy, setBioBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [alertBusy, setAlertBusy] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwTouched, setPwTouched] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [codeStep, setCodeStep] = useState<{ resetId: string; sentTo: string; channel: string } | null>(null)
  const [code, setCode] = useState('')

  useEffect(() => {
    const check = () => {
      const s = biometricState()
      setBio({ canManage: s.canManage, enrolled: s.enrolled })
    }
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [])

  function openPassword() {
    setCurPw(''); setNewPw(''); setNewPw2(''); setPwTouched(false); setPwError(''); setCodeStep(null); setCode('')
    setPwOpen(true)
  }

  const curRule = curPw ? '' : 'Enter your current password'
  const newRule = !newPw ? 'Create a new password' : newPw.length < 6 ? `Use at least 6 characters. This has ${newPw.length}.` : newPw === curPw ? 'Use a different password from your current one' : ''
  const new2Rule = !newPw2 ? 'Type the new password again' : newPw2 !== newPw ? 'The two passwords don’t match' : ''

  async function sendCode() {
    setPwTouched(true)
    if (curRule || newRule || new2Rule) return
    setPwBusy(true); setPwError('')
    try {
      const res = await fetch('/api/customer/password/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPw }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPwError(d.error === 'Current password is incorrect' ? 'Your current password isn’t right.' : d.error ?? 'We couldn’t send a code. Please try again.')
        return
      }
      setCode('')
      setCodeStep({ resetId: d.resetId, sentTo: d.sentTo, channel: d.channel })
    } catch {
      setPwError('No connection. Check your internet and try again.')
    } finally {
      setPwBusy(false)
    }
  }

  async function savePassword() {
    if (!codeStep) return
    if (code.length !== 6) { setPwError('Enter the 6-digit code.'); return }
    setPwBusy(true); setPwError('')
    try {
      const res = await fetch('/api/customer/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw, code, resetId: codeStep.resetId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPwError(d.error === 'Current password is incorrect' ? 'Your current password isn’t right.' : d.error ?? 'Your password wasn’t changed. Please try again.')
        return
      }
      setPwOpen(false)
      setBio(b => ({ ...b, enrolled: false }))
      setToast('Password changed')
    } catch {
      setPwError('No connection. Check your internet and try again.')
    } finally {
      setPwBusy(false)
    }
  }

  async function toggleEmailAlerts() {
    if (!data) return
    setAlertBusy(true)
    try {
      const res = await fetch('/api/customer/email-alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !data.emailAlertsOn }) })
      if (res.ok) reload()
      else setToast('That didn’t work. Check your connection and try again.')
    } catch { setToast('That didn’t work. Check your connection and try again.') }
    setAlertBusy(false)
  }

  async function toggleBiometric() {
    if (!bio.canManage) {
      setToast('Fingerprint sign-in works in the Vochus Easy Save app. Open the app on your phone to turn it on.')
      return
    }
    setBioBusy(true)
    const on = !bio.enrolled
    if (await (on ? enableBiometric() : disableBiometric())) setBio(b => ({ ...b, enrolled: on }))
    else setToast('That didn’t work. Check your connection and try again.')
    setBioBusy(false)
  }

  useEffect(() => {
    setSize(getTextSize())
    setHide(getHideBalance())
  }, [])

  function chooseSize(size: TextSize) {
    setTextSize(size)
    setSize(size)
  }

  function toggleHide() {
    setHideBalance(!hideBalance)
    setHide(!hideBalance)
  }

  async function logout() {
    await fetch('/api/customer/auth/login', { method: 'DELETE' })
    router.push('/customer/login')
  }

  if (loading) return <FormSkeleton label="Loading settings" />

  if (failed || !data) return (
    <div className="ui-screen ui-screen--center">
      {failed && (
        <EmptyState
          icon="error"
          tone="danger"
          title="We couldn't load your settings"
          text="Check your connection and try again."
          action={
            <button type="button" className="ui-btn ui-btn--primary" onClick={reload}>
              <Icons.retry size={18} aria-hidden="true" /> Try again
            </button>
          }
        />
      )}
    </div>
  )

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        <div className="ui-topbar-main">
          <h1 className="ui-page-title">Settings</h1>
        </div>
      </header>

      <main className="ui-container">
        <section className="ui-card ui-card--list" aria-label="Your account">
          <ListRow
            leading={data.photoUrl
              ? <img src={data.photoUrl} className="ui-avatar" alt="" />
              : <span className="ui-avatar" aria-hidden="true">{data.name[0]}</span>}
            title={displayName(data.name)}
            sub={data.customerId}
          />
          <ListRow title="Phone" value={data.phone} />
          {data.email && <ListRow title="Email" value={data.email} />}
        </section>

        {data.email && (
          <>
            <div className="ui-section-head"><h2>Notifications</h2></div>
            <section className="ui-card ui-card--list">
              {data.emailVerified ? (
                <div className="ui-row">
                  <div className="ui-row-main">
                    <div className="ui-row-title" id="email-alerts-label">Email alerts</div>
                    <div className="ui-row-sub">Get an email when someone signs in and when a payment reaches your savings.</div>
                  </div>
                  <button type="button" role="switch" className="ui-switch" aria-checked={!!data.emailAlertsOn} aria-labelledby="email-alerts-label" disabled={alertBusy} onClick={toggleEmailAlerts} />
                </div>
              ) : (
                <ListRow title="Get alerts by email" sub="Confirm your email to get sign-in and payment emails." onClick={() => setEmailOpen(true)} />
              )}
            </section>
          </>
        )}

        <div className="ui-section-head"><h2>Display</h2></div>
        <section className="ui-card">
          <p className="ui-row-title" id="text-size-label">Text size</p>
          <p className="ui-row-sub" style={{ marginBottom: 'var(--ui-s3)' }}>Make words and numbers bigger on this phone.</p>
          <div className="ui-segment" role="group" aria-labelledby="text-size-label">
            <button type="button" aria-pressed={textSize === 'normal'} onClick={() => chooseSize('normal')}>Normal</button>
            <button type="button" aria-pressed={textSize === 'large'} onClick={() => chooseSize('large')} style={{ fontSize: '1.15em' }}>Large</button>
          </div>
        </section>
        <section className="ui-card ui-card--list">
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title" id="hide-balance-label">Hide my balance</div>
              <div className="ui-row-sub">Show ₦ •••• on the home screen until you tap the eye.</div>
            </div>
            <button
              type="button"
              role="switch"
              className="ui-switch"
              aria-checked={hideBalance}
              aria-labelledby="hide-balance-label"
              onClick={toggleHide}
            />
          </div>
        </section>

        <div className="ui-section-head"><h2>Security</h2></div>
        <section className="ui-card ui-card--list">
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title" id="fingerprint-label">Sign in with fingerprint</div>
              <div className="ui-row-sub">
                {bio.canManage ? 'Use your fingerprint instead of your password on this phone.' : 'Available in the Vochus Easy Save app on your phone.'}
              </div>
            </div>
            <button type="button" role="switch" className="ui-switch" aria-checked={bio.enrolled} aria-labelledby="fingerprint-label" aria-disabled={!bio.canManage} disabled={bioBusy} onClick={toggleBiometric} style={bio.canManage ? undefined : { opacity: 0.5 }} />
          </div>
          <ListRow title="Change password" sub="Change the password you sign in with." onClick={openPassword} />
        </section>

        <div className="ui-section-head ui-browser-only"><h2>App</h2></div>
        <section className="ui-card ui-card--list ui-browser-only">
          <ListRow
            leading={<Logo size={40} />}
            title="Vochus Easy Save for Android"
            sub="Faster to open, works like a normal app."
          />
          <div className="ui-btn-row ui-btn-row--single">
            <a className="ui-btn ui-btn--secondary" href="/downloads/easysave-customer.apk" download>
              <Icons.download size={18} aria-hidden="true" /> Download the app
            </a>
          </div>
        </section>

        <button type="button" className="ui-btn ui-btn--danger ui-btn--block" onClick={logout} style={{ marginTop: 'var(--ui-s5)' }}>
          <Icons.logout size={18} aria-hidden="true" /> Log out
        </button>
      </main>

      <BottomSheet open={pwOpen} onClose={() => { if (!pwBusy) setPwOpen(false) }} title="Change password">
        {!codeStep ? (
          <>
            <Field id="cpw" label="Current password" error={pwTouched ? curRule : ''}>
              <input id="cpw" className="ag-tf-input" type="password" autoComplete="current-password" value={curPw} onChange={e => { setCurPw(e.target.value); setPwError('') }} />
            </Field>
            <Field id="npw" label="New password" error={pwTouched ? newRule : ''}>
              <input id="npw" className="ag-tf-input" type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} />
            </Field>
            <Field id="npw2" label="Type the new password again" error={pwTouched ? new2Rule : ''}>
              <input id="npw2" className="ag-tf-input" type="password" autoComplete="new-password" value={newPw2} onChange={e => setNewPw2(e.target.value)} />
            </Field>
            <p className="ui-row-sub">We’ll send a code to confirm it’s you. Fingerprint sign-in turns off on your devices, so turn it on again afterwards.</p>
            <FormError message={pwError} />
            <div className="ui-stack">
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={pwBusy} onClick={sendCode}>
                {pwBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending code…</> : 'Send code'}
              </button>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={pwBusy} onClick={() => setPwOpen(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="ui-row-sub">We sent a 6-digit code {codeStep.channel === 'email' ? 'to your email' : 'by text to'} {codeStep.sentTo}.</p>
            <Field id="pwcode" label="6-digit code">
              <input id="pwcode" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setPwError('') }} />
            </Field>
            <FormError message={pwError} />
            <div className="ui-stack">
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={pwBusy || code.length !== 6} onClick={savePassword}>
                {pwBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Changing…</> : 'Change password'}
              </button>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={pwBusy} onClick={() => { setCodeStep(null); setPwError('') }}>Back</button>
            </div>
          </>
        )}
      </BottomSheet>

      {data.email && <EmailAlertsSheet open={emailOpen} onClose={() => setEmailOpen(false)} email={data.email} onConfirmed={() => { setEmailOpen(false); setToast('Email alerts are on.'); reload() }} />}

      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <CustomerBottomNav />
    </div>
  )
}
