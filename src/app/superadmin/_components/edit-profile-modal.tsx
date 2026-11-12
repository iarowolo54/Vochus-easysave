'use client'

import { useEffect, useState } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { Icons } from '@/components/ui/icons'
import { NG_STATES, lgasOf } from '@/lib/ng-lgas'
import {
  AGENT_PROFILE_FIELDS, CUSTOMER_PROFILE_FIELDS, diffProfile, type ProfileChange, type ProfileField,
} from '@/lib/profile-edit'
import { DialogNote, Field, Ledger, LedgerRow, LoadError, Modal, TableSkeleton } from './admin-ui'

type Who = 'agent' | 'customer'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Staff edit an agent's or customer's personal details: form, then a review of exactly what changes, then save. */
export function EditProfileModal({ who, id, name, onClose, onSaved }: {
  who: Who; id: string; name: string; onClose: () => void; onSaved: (message: string) => void
}) {
  const fields = who === 'agent' ? AGENT_PROFILE_FIELDS : CUSTOMER_PROFILE_FIELDS
  const url = `/api/admin/${who === 'agent' ? 'agents' : 'customers'}/${id}/profile`

  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [form, setForm] = useState<Record<string, string>>({})
  const [canManage, setCanManage] = useState(false)
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [changes, setChanges] = useState<ProfileChange[]>([])
  const [sendKeys, setSendKeys] = useState<string[]>([])
  const [needsPin, setNeedsPin] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setState('loading')
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const d = await res.json() as { values?: Record<string, string>; canManage?: boolean }
      setOriginal(d.values ?? {}); setForm(d.values ?? {}); setCanManage(!!d.canManage); setState('ready')
    } catch {
      setState('failed')
    }
  }
  useEffect(() => { load() }, [url])

  const set = (key: string, value: string) => {
    setError('')
    setForm(f => ({ ...f, [key]: value, ...(key === 'state' && value !== f.state ? { lga: '' } : {}) }))
  }

  function review() {
    // The same check the server runs, so most mistakes show before anything is sent.
    const diff = diffProfile(fields, original, form, { dobAs: 'text' })
    if (!diff.ok) { setError(diff.error); return }
    if (diff.changes.length === 0) { setError('Nothing has changed yet.'); return }
    setChanges(diff.changes); setSendKeys(Object.keys(diff.data)); setNeedsPin(diff.signInChanged)
    setPin(''); setError(''); setStep('review')
  }

  async function save() {
    if (needsPin && !pin.trim()) { setError('Enter your approval PIN.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: Object.fromEntries(sendKeys.map(k => [k, form[k] ?? ''])), ...(needsPin && { pin }) }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'The details weren’t saved. Nothing changed. Try again.'); return }
      onSaved(`${name}’s details saved`)
    } catch {
      setError('No connection. We can’t tell if the details were saved, so reopen this before trying again.')
    } finally {
      setBusy(false)
    }
  }

  function input(f: ProfileField) {
    const v = form[f.key] ?? ''
    const common = { id: `pe-${f.key}`, className: 'a-input', disabled: !canManage }
    switch (f.kind) {
      case 'gender':
        return <select {...common} value={v} onChange={e => set(f.key, e.target.value)}>
          <option value="">Not recorded</option><option value="Female">Female</option><option value="Male">Male</option>
        </select>
      case 'state':
        return <select {...common} value={v} onChange={e => set(f.key, e.target.value)}>
          <option value="">Choose a state</option>{NG_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      case 'lga':
        return <select {...common} value={v} disabled={!canManage || !form.state} onChange={e => set(f.key, e.target.value)}>
          <option value="">{form.state ? 'Choose a local government' : 'Choose the state first'}</option>
          {lgasOf(form.state ?? '').map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      case 'dob':
        return canManage
          ? <DatePicker id={common.id} ariaLabel={f.label} sheetTitle="Pick the date of birth" allowEmpty yearPicker placeholder="Choose a date"
              emptyViewIso={`${new Date().getFullYear() - 30}-01-01`} maxIso={todayIso()} value={v} onChange={iso => set(f.key, iso)} />
          : <input {...common} value={v} readOnly />
      case 'phone':
        return <input {...common} type="tel" inputMode="numeric" autoComplete="off" maxLength={16} value={v} onChange={e => set(f.key, e.target.value)} />
      case 'email':
        return <input {...common} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" maxLength={f.max} value={v} onChange={e => set(f.key, e.target.value)} />
      default:
        return <input {...common} type="text" autoComplete="off" maxLength={f.max} value={v} onChange={e => set(f.key, e.target.value)} />
    }
  }

  const sections = ['Person', 'Contact', 'Next of kin'] as const
  const emailChanged = changes.some(c => c.key === 'email')

  return (
    <Modal icon="enrol" size="lg" title={step === 'form' ? `Edit ${name}’s details` : 'Check the changes'}
      sub={step === 'form' && state === 'ready' && !canManage ? 'You can see these details but not change them.' : undefined}
      onClose={onClose} onBack={step === 'review' ? () => { setError(''); setStep('form') } : undefined} busy={busy}
      error={error || undefined}
      footnote={step === 'review' ? <><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</> : undefined}
      footer={step === 'form' ? <>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        {canManage && <button type="button" className="btn btn-green" disabled={state !== 'ready'} onClick={review}>Continue</button>}
      </> : <>
        <button type="button" className="btn btn-outline" onClick={() => { setError(''); setStep('form') }} disabled={busy}>Back</button>
        <button type="button" className="btn btn-green" onClick={save} disabled={busy} aria-busy={busy}>
          {busy ? <><span className="a-spin" aria-hidden="true" /> Saving…</> : 'Save changes'}
        </button>
      </>}>
      {state === 'loading' ? <TableSkeleton rows={6} cols={2} />
        : state === 'failed' ? <LoadError what="these details" onRetry={load} />
        : step === 'form' ? (
          <form onSubmit={e => { e.preventDefault(); if (canManage) review() }} noValidate>
            {sections.map(s => (
              <div key={s} className="cm-sec">
                <h3 className="cm-sec-title">{s}</h3>
                {fields.filter(f => f.section === s).map(f => (
                  <Field key={f.key} id={`pe-${f.key}`} label={f.label}>{input(f)}</Field>
                ))}
              </div>
            ))}
          </form>
        ) : (
          <>
            <Ledger>
              {changes.map(c => (
                <LedgerRow key={c.key} label={c.label}>
                  <span className="am-diff-val"><span className="am-diff-old">{c.from || 'None'}</span>{c.to || 'None'}</span>
                </LedgerRow>
              ))}
            </Ledger>
            {needsPin && <>
              <DialogNote warn>The phone number and email decide where sign-in and reset codes go, so this needs your approval PIN.</DialogNote>
              <Field id="pe-pin" label="Your approval PIN">
                <input id="pe-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin}
                  onChange={e => { setPin(e.target.value); setError('') }} />
              </Field>
            </>}
            {emailChanged && <DialogNote>The new email has to be confirmed again before codes are sent to it.</DialogNote>}
          </>
        )}
    </Modal>
  )
}
