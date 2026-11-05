'use client'

import { useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import BankSelect from '@/components/ui/BankSelect'
import { NIGERIAN_BANKS } from '@/lib/banks'
import { cleanAccountName } from '@/lib/payout-account'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import PhoneSettings from '@/components/agent/PhoneSettings'
import { formatDate, formatNaira } from '@/lib/format'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'

interface Agent { id: string; agentId: string; name: string; phone: string; location: string; walletBalance: number; createdAt: string; profileUnlocked: boolean; hasPin: boolean; photoUrl?: string | null; email?: string | null; emailVerified?: boolean; emailAlertsOn?: boolean }
type Bank = { bankCode?: string; bankName?: string; accountNumber?: string; accountName?: string }

const initials = (name: string) => name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()

export default function SettingsPage() {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [failed, setFailed] = useState(false)
  const [toast, setToast] = useState('')
  const [sheet, setSheet] = useState<'profile' | 'bank' | 'pin' | 'password' | null>(null)

  // Profile
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)

  // Bank
  const [bank, setBank] = useState<Bank | null>(null)
  const [pick, setPick] = useState<{ code: string; name: string } | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bankError, setBankError] = useState('')
  const [bankBusy, setBankBusy] = useState(false)

  // PIN
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [password, setPassword] = useState('')
  const [pinTouched, setPinTouched] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  // Password
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwTouched, setPwTouched] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [alertBusy, setAlertBusy] = useState(false)

  async function toggleEmailAlerts() {
    if (!agent) return
    setAlertBusy(true)
    const on = !agent.emailAlertsOn
    try {
      const res = await fetch('/api/agent/email-alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })
      if (res.ok) setAgent({ ...agent, emailAlertsOn: on })
      else setToast('That didn’t work. Check your connection and try again.')
    } catch { setToast('That didn’t work. Check your connection and try again.') }
    setAlertBusy(false)
  }

  useEffect(() => {
    fetch('/api/agent')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setAgent(d.agent))
      .catch(() => setFailed(true))
    fetch('/api/agent/bank').then(r => r.json()).then(d => { if (d.bank) setBank(d.bank) }).catch(() => {})
  }, [])

  function openProfile() {
    if (!agent) return
    setName(agent.name); setPhone(agent.phone); setLocation(agent.location); setProfileError('')
    setSheet('profile')
  }

  function openBank() {
    setPick(bank?.bankCode ? { code: bank.bankCode, name: bank.bankName ?? '' } : null)
    setAccountNumber(bank?.accountNumber ?? '')
    setAccountName(bank?.accountName ?? '')
    setBankError('')
    setSheet('bank')
  }

  function openPin() {
    setPin(''); setPin2(''); setPassword(''); setPinTouched(false); setPinError('')
    setSheet('pin')
  }

  function openPassword() {
    setCurPw(''); setNewPw(''); setNewPw2(''); setPwTouched(false); setPwError('')
    setSheet('password')
  }

  const curRule = curPw ? '' : 'Enter your current password'
  const newRule = !newPw ? 'Create a new password' : newPw.length < 6 ? `Use at least 6 characters. This has ${newPw.length}.` : newPw === curPw ? 'Use a different password from your current one' : ''
  const new2Rule = !newPw2 ? 'Type the new password again' : newPw2 !== newPw ? 'The two passwords don’t match' : ''

  async function savePassword() {
    setPwTouched(true)
    if (curRule || newRule || new2Rule) return
    setPwBusy(true); setPwError('')
    try {
      const res = await fetch('/api/agent/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPwError(data.error === 'Current password is incorrect' ? 'Your current password isn’t right.' : data.error ?? 'Your password wasn’t changed. Please try again.')
        return
      }
      setSheet(null)
      setToast('Password changed')
    } catch {
      setPwError('No connection. Check your internet and try again.')
    } finally {
      setPwBusy(false)
    }
  }

  async function saveProfile() {
    if (!name.trim() || !location.trim() || !/^0\d{10}$/.test(phone)) { setProfileError('Check your name, an 11-digit phone number starting with 0, and your location.'); return }
    setProfileBusy(true); setProfileError('')
    try {
      const res = await fetch('/api/agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, location: location.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setProfileError(data.error ?? 'Your changes weren’t saved. Please try again.'); return }
      setAgent(a => a ? { ...a, ...data.agent } : data.agent)
      setSheet(null)
      setToast('Profile saved')
    } catch {
      setProfileError('No connection. Check your internet and try again.')
    } finally {
      setProfileBusy(false)
    }
  }

  async function saveBank() {
    if (!pick || !/^\d{10}$/.test(accountNumber)) { setBankError('Choose your bank and enter your 10-digit account number.'); return }
    if (!cleanAccountName(accountName)) { setBankError('Enter the account name exactly as it is on the bank account.'); return }
    setBankBusy(true); setBankError('')
    try {
      const res = await fetch('/api/agent/bank', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode: pick.code, accountNumber, accountName: accountName.trim() }),
      })
      const text = await res.text()
      const d = text ? JSON.parse(text) : {}
      if (!res.ok) { setBankError(d.error ?? 'Your bank account wasn’t saved. Please try again.'); return }
      setBank(d.bank)
      setSheet(null)
      setToast('Payout account saved')
    } catch {
      setBankError('No connection. Check your internet and try again.')
    } finally {
      setBankBusy(false)
    }
  }

  const pinRule = !pin ? 'Enter a PIN' : !/^\d{4,6}$/.test(pin) ? 'Use 4 to 6 digits' : ''
  const pin2Rule = !pin2 ? 'Type the PIN again' : pin2 !== pin ? 'The two PINs don’t match' : ''
  const pwRule = !password ? 'Enter your sign-in password to confirm' : ''

  async function savePin() {
    setPinTouched(true)
    if (pinRule || pin2Rule || pwRule) return
    setPinBusy(true); setPinError('')
    try {
      const res = await fetch('/api/agent/transaction-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, currentPassword: password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setPinError(data.error === 'Incorrect password' ? 'That password isn’t right.' : data.error ?? 'Your PIN wasn’t saved. Please try again.'); return }
      const changed = agent?.hasPin
      setAgent(a => a ? { ...a, hasPin: true } : a)
      setSheet(null)
      setToast(changed ? 'Transaction PIN changed' : 'Transaction PIN set')
    } catch {
      setPinError('No connection. Check your internet and try again.')
    } finally {
      setPinBusy(false)
    }
  }

  if (failed && !agent) {
    return <div className="ag-page"><section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your settings" text="Check your connection and refresh the page." /></section></div>
  }
  if (!agent) return <div className="ag-page"><ListSkeleton count={5} /></div>

  const hasName = !!bank?.accountName
  const savedBank = !!bank?.accountNumber

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head"><h2>Profile</h2></div>
          <section className="ui-card ag-set-card">
            <div className="ag-set-person">
              {agent.photoUrl
                ? <img src={agent.photoUrl} alt="" className="ag-set-photo" />
                : <span className="ui-avatar ag-set-photo" aria-hidden="true">{initials(agent.name)}</span>}
              <div className="ag-crow-main">
                <p className="ag-set-name">{agent.name}</p>
                <p className="ui-row-sub">{agent.agentId} · {agent.location}</p>
              </div>
            </div>
            <dl className="ag-set-rows">
              <div><dt>Full name</dt><dd>{agent.name}</dd></div>
              <div><dt>Phone</dt><dd>{agent.phone}</dd></div>
              <div><dt>Location</dt><dd>{agent.location}</dd></div>
            </dl>
            {agent.profileUnlocked
              ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={openProfile}>Edit details</button>
              : <p className="ag-set-note"><Icons.locked size={16} aria-hidden="true" /> To change these, ask your admin to unlock your profile.</p>}
          </section>

          <div className="ui-section-head"><h2>Payout account</h2>
            <span className={`ag-crow-tag ${hasName ? 'ag-crow-tag--ok' : savedBank ? 'ag-crow-tag--soon' : 'ag-crow-tag--due'}`}>{hasName ? 'Added' : savedBank ? 'Name missing' : 'Not added'}</span>
          </div>
          <section className="ui-card ag-set-card">
            {savedBank ? (
              <div className="ag-set-bank">
                <span className="ag-topup-icon" aria-hidden="true"><Icons.loan size={20} /></span>
                <div className="ag-crow-main">
                  <p className="ag-crow-name">{bank?.accountName || 'Account name missing'}</p>
                  <p className="ui-row-sub">{bank?.bankName} · <span className="ag-mono">{bank?.accountNumber}</span></p>
                </div>
              </div>
            ) : (
              <p className="ui-row-sub">Add the bank account your commission is paid into.</p>
            )}
            {savedBank && !hasName && <p className="ag-set-note ag-set-note--warn"><Icons.error size={16} aria-hidden="true" /> This account has no name on it. Change the account and add the name so your payout can be sent.</p>}
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={openBank}>{savedBank ? 'Change account' : 'Add bank account'}</button>
          </section>

          <div className="ui-section-head"><h2>Security</h2></div>
          <section className="ui-card ui-card--list">
            <button type="button" className="ag-crow" onClick={openPin}>
              <span className={`ag-report-icon ${agent.hasPin ? 'ag-report-icon--ok' : 'ag-report-icon--open'}`} aria-hidden="true"><Icons.locked size={18} /></span>
              <span className="ag-crow-main">
                <span className="ag-crow-name">Transaction PIN</span>
                <span className="ag-crow-sub">{agent.hasPin ? 'You enter it to confirm each saving you record' : 'Needed before you can record savings'}</span>
              </span>
              <span className="ag-crow-end"><span className={`ag-crow-tag ${agent.hasPin ? 'ag-crow-tag--ok' : 'ag-crow-tag--due'}`}>{agent.hasPin ? 'Set' : 'Not set'}</span></span>
            </button>
            <button type="button" className="ag-crow" onClick={openPassword}>
              <span className="ag-report-icon ag-set-icon" aria-hidden="true"><Icons.fingerprint size={18} /></span>
              <span className="ag-crow-main">
                <span className="ag-crow-name">Password</span>
                <span className="ag-crow-sub">Change the password you sign in with</span>
              </span>
              <span className="ag-crow-end"><Icons.next size={18} aria-hidden="true" /></span>
            </button>
          </section>

          <PhoneSettings />
        </div>

        <div className="ag-col">
          {agent.email && agent.emailVerified && (
            <>
              <div className="ui-section-head"><h2>Notifications</h2></div>
              <section className="ui-card ui-card--list">
                <div className="ui-row">
                  <div className="ui-row-main">
                    <div className="ui-row-title" id="email-alerts-label">Email alerts</div>
                    <div className="ui-row-sub">Get an email when someone signs in and when a wallet top-up reaches your wallet.</div>
                  </div>
                  <button type="button" role="switch" className="ui-switch" aria-checked={!!agent.emailAlertsOn} aria-labelledby="email-alerts-label" disabled={alertBusy} onClick={toggleEmailAlerts} />
                </div>
              </section>
            </>
          )}

          <div className="ui-section-head"><h2>Account</h2></div>
          <section className="ui-card ag-set-card">
            <dl className="ag-set-rows">
              <div><dt>Agent ID</dt><dd className="ag-mono">{agent.agentId}</dd></div>
              <div><dt>Joined</dt><dd>{formatDate(agent.createdAt)}</dd></div>
              <div><dt>Wallet balance</dt><dd>{formatNaira(agent.walletBalance)}</dd></div>
            </dl>
          </section>

          <div className="ui-section-head"><h2>Android app</h2></div>
          <section className="ui-card ag-set-card">
            <p className="ui-row-sub">The Vochus Easy Save Agent app for Android, with receipt printing on a Bluetooth printer.</p>
            <a href="/downloads/easysave-agent.apk" download className="ui-btn ui-btn--primary ui-btn--block"><Icons.download size={18} aria-hidden="true" /> Download for Android</a>
          </section>
        </div>
      </div>

      <BottomSheet open={sheet === 'profile'} onClose={() => { if (!profileBusy) setSheet(null) }} title="Edit your details">
        <p className="ag-set-note ag-set-note--warn"><Icons.locked size={16} aria-hidden="true" /> You can save one change. After that, your profile locks until your admin unlocks it again.</p>
        <Field id="pf-name" label="Full name"><input id="pf-name" className="ag-tf-input" autoCapitalize="words" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field id="pf-phone" label="Phone number"><input id="pf-phone" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} value={phone} onKeyDown={blockNonDigit} onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))} /></Field>
        <Field id="pf-loc" label="Location"><input id="pf-loc" className="ag-tf-input" value={location} onChange={e => setLocation(e.target.value)} /></Field>
        <FormError message={profileError} />
        <div className="ui-stack">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={profileBusy} onClick={saveProfile}>
            {profileBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Saving…</> : 'Save changes'}
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={profileBusy} onClick={() => setSheet(null)}>Cancel</button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'bank'} onClose={() => { if (!bankBusy) setSheet(null) }} title={savedBank ? 'Change payout account' : 'Add payout account'}>
        <p className="ag-sheet-text">Your commission is paid into this account. Use an account in your own name, and type the account name exactly as your bank shows it.</p>
        <div className="ag-tf-wrap">
          <BankSelect banks={NIGERIAN_BANKS} placeholder="Choose your bank" value={pick} onChange={b => { setPick(b); setBankError('') }} />
        </div>
        <Field id="bk-acct" label="Account number">
          <input id="bk-acct" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={10} placeholder="10 digits"
            value={accountNumber} onKeyDown={blockNonDigit} onChange={e => { setAccountNumber(digitsOnly(e.target.value).slice(0, 10)); setBankError('') }} />
        </Field>
        <Field id="bk-name" label="Account name">
          <input id="bk-name" className="ag-tf-input" autoComplete="off" autoCapitalize="characters" maxLength={80} placeholder="As it is on the account"
            value={accountName} onChange={e => { setAccountName(e.target.value); setBankError('') }} />
        </Field>
        <FormError message={bankError} />
        <div className="ui-stack">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={bankBusy} onClick={() => saveBank()}>
            {bankBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Saving…</> : 'Save account'}
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={bankBusy} onClick={() => setSheet(null)}>Cancel</button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'password'} onClose={() => { if (!pwBusy) setSheet(null) }} title="Change password">
        <Field id="cpw" label="Current password" error={pwTouched ? curRule : ''}>
          <input id="cpw" className="ag-tf-input" type="password" autoComplete="current-password" value={curPw} onChange={e => { setCurPw(e.target.value); setPwError('') }} />
        </Field>
        <Field id="npw" label="New password" error={pwTouched ? newRule : ''}>
          <input id="npw" className="ag-tf-input" type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} />
        </Field>
        <Field id="npw2" label="Type the new password again" error={pwTouched ? new2Rule : ''}>
          <input id="npw2" className="ag-tf-input" type="password" autoComplete="new-password" value={newPw2} onChange={e => setNewPw2(e.target.value)} />
        </Field>
        <p className="ag-set-note"><Icons.fingerprint size={16} aria-hidden="true" /> Fingerprint sign-in turns off on your devices. Set it up again after you sign in with the new password.</p>
        <FormError message={pwError} />
        <div className="ui-stack">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={pwBusy} onClick={savePassword}>
            {pwBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Changing…</> : 'Change password'}
          </button>
          <Link href="/forgot-password" className="ui-btn ui-btn--plain ui-btn--block">Forgot it? Reset with a code</Link>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'pin'} onClose={() => { if (!pinBusy) setSheet(null) }} title={agent.hasPin ? 'Change transaction PIN' : 'Set transaction PIN'}>
        <p className="ag-sheet-text">You’ll enter this PIN to confirm each saving you record. Don’t share it with anyone.</p>
        <Field id="pin-1" label={agent.hasPin ? 'New PIN (4–6 digits)' : 'PIN (4–6 digits)'} error={pinTouched ? pinRule : ''}>
          <input id="pin-1" className="ag-tf-input ag-tf-num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
            value={pin} onKeyDown={blockNonDigit} onChange={e => setPin(digitsOnly(e.target.value).slice(0, 6))} />
        </Field>
        <Field id="pin-2" label="Type it again" error={pinTouched ? pin2Rule : ''}>
          <input id="pin-2" className="ag-tf-input ag-tf-num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
            value={pin2} onKeyDown={blockNonDigit} onChange={e => setPin2(digitsOnly(e.target.value).slice(0, 6))} />
        </Field>
        <Field id="pin-pw" label="Your sign-in password" error={pinTouched ? pwRule : ''}>
          <input id="pin-pw" className="ag-tf-input" type="password" autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setPinError('') }} />
        </Field>
        <FormError message={pinError} />
        <div className="ui-stack">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={pinBusy} onClick={savePin}>
            {pinBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Saving…</> : agent.hasPin ? 'Change PIN' : 'Set PIN'}
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={pinBusy} onClick={() => setSheet(null)}>Cancel</button>
        </div>
      </BottomSheet>
    </div>
  )
}

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
