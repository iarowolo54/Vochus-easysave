'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import AmountField from '@/components/ui/AmountField'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { formatDate, formatNaira } from '@/lib/format'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'

interface SubAgent { id: string; name: string; phone: string; location: string; walletBalance: number; createdAt: string; photoUrl?: string | null }

const QUICK = [5000, 10000, 20000, 50000]
const initials = (name: string) => name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()

export default function SubAgentsPage() {
  const { update } = useSession()
  const [subAgents, setSubAgents] = useState<SubAgent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [wallet, setWallet] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  // Give money
  const [funding, setFunding] = useState<SubAgent | null>(null)
  const [amount, setAmount] = useState('')
  const [fundError, setFundError] = useState('')
  const [fundBusy, setFundBusy] = useState(false)

  // Add a sub-agent
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [addTouched, setAddTouched] = useState(false)
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/subagents')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSubAgents(data.subAgents ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
      setSubAgents(prev => prev ?? [])
    }
    fetch('/api/agent').then(r => r.json()).then(d => { if (typeof d.agent?.walletBalance === 'number') setWallet(d.agent.walletBalance) }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const amt = parseFloat(amount || '0')
  const short = wallet !== null && amt > wallet

  async function fund() {
    if (!funding) return
    if (!amt || amt <= 0) { setFundError('Enter how much to give.'); return }
    if (short) { setFundError(`That’s more than the ${formatNaira(wallet ?? 0)} in your wallet.`); return }
    setFundBusy(true); setFundError('')
    try {
      const res = await fetch(`/api/subagents/${funding.id}/fund`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFundError(data.error === 'Insufficient wallet balance' ? 'Your wallet doesn’t have enough for this. Top up first.' : data.error ?? 'The money wasn’t sent. Please try again.')
        return
      }
      setToast(`${formatNaira(amt, { minor: false })} given to ${funding.name}`)
      setFunding(null); setAmount('')
      update()
      load()
    } catch {
      setFundError('We lost the connection. Check their balance before trying again, so you don’t send it twice.')
      load()
    } finally {
      setFundBusy(false)
    }
  }

  const nameError = !name.trim() ? 'Enter their full name' : ''
  const phoneErr = !phone ? 'Enter their phone number'
    : phone.length < 11 ? `Phone numbers have 11 digits. This has ${phone.length}.`
    : !phone.startsWith('0') ? 'Start with 0, like 0803 123 4567' : ''
  const locationError = !location.trim() ? 'Enter where they work, like Yaba, Lagos' : ''

  async function addSubAgent() {
    setAddTouched(true)
    if (nameError || phoneErr || locationError) return
    if ((subAgents ?? []).some(a => a.phone === phone)) { setAddError('You already have a sub-agent with this phone number.'); return }
    setAddBusy(true); setAddError('')
    try {
      const res = await fetch('/api/subagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, location: location.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The API doesn't explain a clash yet; a phone already used by another agent's sub-agent is the usual cause.
        setAddError(data.error ?? 'We couldn’t add them. If this phone number is already registered as a sub-agent, use a different one.')
        return
      }
      setToast(`${name.trim()} added as a sub-agent`)
      closeAdd()
      load()
    } catch {
      setAddError('No connection. Check your internet and try again.')
    } finally {
      setAddBusy(false)
    }
  }

  function closeAdd() {
    setAdding(false); setName(''); setPhone(''); setLocation(''); setAddTouched(false); setAddError('')
  }

  const total = (subAgents ?? []).reduce((s, a) => s + a.walletBalance, 0)

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head">
            <h2>Your sub-agents</h2>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => setAdding(true)}><Icons.add size={18} aria-hidden="true" /> Add sub-agent</button>
          </div>
          {subAgents === null ? (
            <ListSkeleton count={3} />
          ) : failed && subAgents.length === 0 ? (
            <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your sub-agents" text="Check your connection and try again."
              action={<button type="button" className="ui-btn ui-btn--secondary" onClick={() => { setSubAgents(null); load() }}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} /></section>
          ) : subAgents.length === 0 ? (
            <section className="ui-card"><EmptyState icon="team" title="No sub-agents yet" text="Add people who collect savings for you, then give them money from your wallet."
              action={<button type="button" className="ui-btn ui-btn--primary" onClick={() => setAdding(true)}><Icons.add size={18} aria-hidden="true" /> Add sub-agent</button>} /></section>
          ) : (
            <section className="ui-card ui-card--list" aria-label="Sub-agents">
              {subAgents.map(a => (
                <div key={a.id} className="ag-crow ag-sa-row">
                  {a.photoUrl
                    ? <img className="ui-avatar ag-av ag-sa-photo" src={a.photoUrl} alt="" />
                    : <span className={`ui-avatar ag-av ag-av--${avatarTint(a.phone)}`} aria-hidden="true">{initials(a.name)}</span>}
                  <span className="ag-crow-main">
                    <span className="ag-crow-name">{a.name}</span>
                    <span className="ag-crow-sub">{a.phone} · {a.location}</span>
                    <span className="ag-crow-sub">Added {formatDate(a.createdAt)}</span>
                  </span>
                  <span className="ag-crow-end">
                    <span className="ag-crow-bal">{formatNaira(a.walletBalance, { minor: false })}</span>
                    <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => { setFunding(a); setAmount(''); setFundError('') }}>Give money</button>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Summary</h2></div>
          <section className="ui-card ag-funded" aria-label="Money given to sub-agents">
            <div>
              <span className="ui-row-sub ui-block">Held by your sub-agents</span>
              <span className="ag-funded-value">{subAgents ? formatNaira(total, { minor: false }) : '–'}</span>
            </div>
            <span className="ag-funded-count">{subAgents ? subAgents.length : '–'}<span>sub-agent{subAgents?.length === 1 ? '' : 's'}</span></span>
          </section>
          <section className="ui-card ag-sa-wallet">
            <span className="ag-topup-icon" aria-hidden="true"><Icons.wallet size={20} /></span>
            <span className="ag-crow-main">
              <span className="ui-row-sub ui-block">Your wallet</span>
              <span className="ag-crow-name">{wallet === null ? '–' : formatNaira(wallet)}</span>
            </span>
            <Link href={`/dashboard/wallet?return=${encodeURIComponent('/dashboard/subagents')}`} className="ui-btn ui-btn--plain ui-btn--sm">Top up</Link>
          </section>
          <div className="ui-section-head"><h2>How it works</h2></div>
          <ul className="ag-rules">
            <li><Icons.check size={16} aria-hidden="true" /> Money you give a sub-agent leaves your wallet straight away</li>
            <li><Icons.check size={16} aria-hidden="true" /> It can’t be taken back from this page, so check the amount first</li>
            <li><Icons.check size={16} aria-hidden="true" /> Each sub-agent needs their own phone number</li>
          </ul>
        </div>
      </div>

      <BottomSheet open={!!funding} onClose={() => { if (!fundBusy) setFunding(null) }} title={funding ? `Give money to ${funding.name.split(' ')[0]}` : 'Give money'}>
        {funding && (
          <>
            <AmountField value={amount} onChange={v => { setAmount(v); setFundError('') }} invalid={short}
              hint={short ? `More than the ${formatNaira(wallet ?? 0, { minor: false })} in your wallet` : 'From your wallet to theirs'} />
            <div className="ag-quick" role="group" aria-label="Quick amounts">
              {QUICK.map(n => (
                <button key={n} type="button" className="ag-chip" aria-pressed={amt === n} onClick={() => { setAmount(String(n)); setFundError('') }}>{formatNaira(n, { minor: false })}</button>
              ))}
            </div>
            <dl className="ag-breakdown">
              <div><dt>{funding.name.split(' ')[0]} has</dt><dd>{formatNaira(funding.walletBalance)}</dd></div>
              {amt > 0 && !short && <div><dt>They’ll have</dt><dd>{formatNaira(funding.walletBalance + amt)}</dd></div>}
              {wallet !== null && <div className="ag-breakdown-total"><dt>Your wallet after</dt><dd className={short ? 'ag-neg' : undefined}>{formatNaira(wallet - (amt || 0))}</dd></div>}
            </dl>
            <p className="ag-sheet-text ag-sa-warn"><Icons.error size={16} aria-hidden="true" /> This can’t be undone from the app.</p>
            <FormError message={fundError} />
            <div className="ui-stack">
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={fundBusy || !amt || short} onClick={fund}>
                {fundBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : amt > 0 ? `Give ${formatNaira(amt, { minor: false })}` : 'Give money'}
              </button>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={fundBusy} onClick={() => setFunding(null)}>Cancel</button>
            </div>
          </>
        )}
      </BottomSheet>

      <BottomSheet open={adding} onClose={() => { if (!addBusy) closeAdd() }} title="Add a sub-agent">
        <p className="ag-sheet-text">Someone who collects savings for you. You can give them money from your wallet once they’re added.</p>
        <SheetField id="sa-name" label="Full name" error={addTouched ? nameError : ''}>
          <input id="sa-name" className="ag-tf-input" autoCapitalize="words" placeholder="e.g. Kemi Adebisi" value={name} onChange={e => setName(e.target.value)} />
        </SheetField>
        <SheetField id="sa-phone" label="Phone number" error={addTouched ? phoneErr : ''}>
          <input id="sa-phone" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="080 0000 0000"
            value={phone} onKeyDown={blockNonDigit} onChange={e => { setPhone(digitsOnly(e.target.value).slice(0, 11)); setAddError('') }} />
        </SheetField>
        <SheetField id="sa-loc" label="Where they work" error={addTouched ? locationError : ''}>
          <input id="sa-loc" className="ag-tf-input" placeholder="e.g. Yaba, Lagos" value={location} onChange={e => setLocation(e.target.value)} />
        </SheetField>
        <FormError message={addError} />
        <div className="ui-stack">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={addBusy} onClick={addSubAgent}>
            {addBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Adding…</> : 'Add sub-agent'}
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={addBusy} onClick={closeAdd}>Cancel</button>
        </div>
      </BottomSheet>
    </div>
  )
}

function SheetField({ id, label, error, children }: { id: string; label: string; error: string; children: ReactNode }) {
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
