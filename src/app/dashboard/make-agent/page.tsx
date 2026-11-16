'use client'

// The agent asks for one of their online customers to become an agent. Two steps: details, then check and send.
// No documents: they're private, so the customer uploads their own after the office approves.
// ?id=<customer id> starts a new request; ?request=<request id> fixes and resends one that wasn't approved.
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { NG_STATES, lgasOf } from '@/lib/ng-lgas'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import { displayName } from '@/lib/format'

type Form = { nin: string; bvn: string; state: string; lga: string; address: string; nokName: string; nokPhone: string }
const EMPTY: Form = { nin: '', bvn: '', state: '', lga: '', address: '', nokName: '', nokPhone: '' }

export default function MakeAgentPage() {
  return <Suspense fallback={<div className="ag-page"><section className="ui-card ag-flow-block"><span className="ui-spinner" role="status" aria-label="Loading" /></section></div>}><MakeAgent /></Suspense>
}

function MakeAgent() {
  const params = useSearchParams()
  const customerId = params.get('id')
  const requestId = params.get('request')
  const [name, setName] = useState('')
  const [blocked, setBlocked] = useState<{ title: string; text: string; list?: string[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [step, setStep] = useState<1 | 2 | 'done'>(1)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState('')
  const [blockers, setBlockers] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [fix, setFix] = useState<{ reason: string | null; fix: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      if (requestId) {
        const res = await fetch(`/api/agent-upgrade-requests/${encodeURIComponent(requestId)}`)
        if (res.status === 404) { setBlocked({ title: 'Request not found', text: 'Open it from Requests, then Upgrades.' }); return }
        if (!res.ok) throw new Error()
        const d = await res.json() as { request: { status: string; nin: string; bvn: string | null; state: string; lga: string; address: string; nokName: string; nokPhone: string; denyReason: string | null; denyFix: string | null; customer: { firstName: string; lastName: string } }; blockers: string[] }
        const r = d.request
        setName(displayName(`${r.customer.firstName} ${r.customer.lastName}`))
        if (r.status !== 'Denied') setBlocked({ title: 'Nothing to fix', text: 'Only a request that wasn’t approved can be sent again.' })
        else if (d.blockers.length) setBlocked({ title: 'Finish these first', text: 'Their customer account must have nothing left open.', list: d.blockers })
        setForm({ nin: r.nin, bvn: r.bvn ?? '', state: r.state, lga: r.lga, address: r.address, nokName: r.nokName, nokPhone: r.nokPhone })
        setFix({ reason: r.denyReason, fix: r.denyFix })
      } else if (customerId) {
        const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/agent-upgrade`)
        if (res.status === 404) { setBlocked({ title: 'Customer not found', text: 'Open the customer from your list and try again.' }); return }
        if (!res.ok) throw new Error()
        const d = await res.json() as { customer: { firstName: string; lastName: string; address: string; state: string | null; lga: string | null; nokName: string; nokPhone: string }; notEligible: string | null; blockers: string[]; open: { status: string } | null }
        const c = d.customer
        setName(displayName(`${c.firstName} ${c.lastName}`))
        if (d.notEligible) setBlocked({ title: 'They can’t become an agent', text: d.notEligible })
        else if (d.open) setBlocked({ title: 'An upgrade is already waiting', text: 'The office is reviewing it.' })
        else if (d.blockers.length) setBlocked({ title: 'Finish these first', text: 'They stop being a customer when they become an agent, so nothing can be left open on their account.', list: d.blockers })
        setForm({ ...EMPTY, address: c.address ?? '', state: c.state ?? '', lga: c.lga ?? '', nokName: c.nokName ?? '', nokPhone: c.nokPhone ?? '' })
      } else {
        setBlocked({ title: 'Choose a customer', text: 'Open an online customer and tap Make agent.' })
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [customerId, requestId])

  useEffect(() => { load() }, [load])

  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const fieldErr: Partial<Record<keyof Form, string>> = {
    ...(!/^\d{11}$/.test(form.nin) && { nin: 'Enter the 11-digit NIN' }),
    ...(form.bvn && !/^\d{11}$/.test(form.bvn) && { bvn: 'The BVN has 11 digits' }),
    ...(!form.state && { state: 'Choose their state' }),
    ...(!form.lga && { lga: form.state ? 'Choose their LGA' : 'Choose a state first' }),
    ...(form.address.trim().length < 5 && { address: 'Enter their home address' }),
    ...(form.nokName.trim().length < 2 && { nokName: 'Enter the next of kin’s name' }),
    ...(!/^0\d{10}$/.test(form.nokPhone) && { nokPhone: 'Enter an 11-digit phone number' }),
  }
  const show = (k: keyof Form) => (tried ? fieldErr[k] ?? '' : '')

  function next() {
    setError('')
    setTried(true)
    if (Object.keys(fieldErr).length) return
    setStep(2)
    window.scrollTo(0, 0)
  }

  async function send() {
    setSending(true); setError(''); setBlockers([])
    try {
      const res = await fetch(requestId ? `/api/agent-upgrade-requests/${encodeURIComponent(requestId)}` : `/api/customers/${encodeURIComponent(customerId ?? '')}/agent-upgrade`, {
        method: requestId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; blockers?: string[] }
      if (!res.ok) { setError(d.error ?? 'It couldn’t be sent. Try again.'); setBlockers(d.blockers ?? []); return }
      setStep('done')
      window.scrollTo(0, 0)
    } catch {
      setError('Check your internet and try again.')
    } finally {
      setSending(false)
    }
  }

  const head = (
    <section className="ag-hello">
      <div>
        <h1 className="ag-q">{requestId ? 'Fix and send again' : 'Make agent'}</h1>
        {name && <p className="ag-sub">{name}</p>}
      </div>
    </section>
  )

  if (loading) return <div className="ag-page">{head}<section className="ui-card ag-flow-block"><span className="ui-spinner" role="status" aria-label="Loading" /></section></div>
  if (failed) return (
    <div className="ag-page">{head}
      <section className="ui-card ag-flow-block">
        <EmptyState icon="error" title="This couldn’t load" text="Check your internet and try again." action={<button type="button" className="ui-btn ui-btn--primary" onClick={load}>Try again</button>} />
      </section>
    </div>
  )
  if (blocked) return (
    <div className="ag-page">{head}
      <section className="ui-card ag-flow-block">
        <EmptyState icon="pending" title={blocked.title} text={blocked.text} />
        {blocked.list && <ul className="ag-upg-list">{blocked.list.map(b => <li key={b}>{b}</li>)}</ul>}
        <Link href="/dashboard/customers" className="ui-btn ui-btn--secondary ui-btn--block">Back to customers</Link>
      </section>
    </div>
  )
  if (step === 'done') return (
    <div className="ag-page">
      <section className="ui-card ag-done ag-flow-done">
        <span className="ui-status ui-status--success ui-status--lg"><Icons.check size={28} aria-hidden="true" /></span>
        <h1 className="ag-q">{requestId ? 'Sent again' : 'Request sent'}</h1>
        <p className="ui-row-sub ui-block">The office will review it. If they approve, {name} uploads their own documents before they can start.</p>
        <Link href="/dashboard/customers/requests?tab=agents" className="ui-btn ui-btn--primary ui-btn--block">See upgrades</Link>
      </section>
    </div>
  )

  return (
    <div className="ag-page">
      {head}
      <p className="ag-upg-steps" aria-label={`Step ${step} of 2`}>Step {step} of 2 · {step === 1 ? 'Details' : 'Check and send'}</p>

      {fix && step === 1 && (
        <section className="ui-card ag-creq-why">
          <p className="ui-row-sub">Why it wasn’t approved</p><p>{fix.reason}</p>
          <p className="ui-row-sub">What to work on</p><p>{fix.fix}</p>
        </section>
      )}

      {step === 1 && (
        <section className="ui-card ag-flow-block">
          <Field id="nin" label="NIN" required error={show('nin')}>
            <input id="nin" className="ag-tf-input ag-tf-num" inputMode="numeric" maxLength={11} value={form.nin} onKeyDown={blockNonDigit} onChange={e => set('nin', digitsOnly(e.target.value))} />
          </Field>
          <Field id="bvn" label="BVN" error={show('bvn')} hint="Optional">
            <input id="bvn" className="ag-tf-input ag-tf-num" inputMode="numeric" maxLength={11} value={form.bvn} onKeyDown={blockNonDigit} onChange={e => set('bvn', digitsOnly(e.target.value))} />
          </Field>
          <div className="ag-grid-2">
            <Field id="st" label="State" required error={show('state')}>
              <select id="st" className="ag-tf-input ag-tf-select" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value, lga: '' }))}>
                <option value="">Choose</option>
                {NG_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field id="lga" label="Local government" required error={show('lga')}>
              <select id="lga" className="ag-tf-input ag-tf-select" value={form.lga} disabled={!form.state} onChange={e => set('lga', e.target.value)}>
                <option value="">{form.state ? 'Choose' : 'Choose a state first'}</option>
                {lgasOf(form.state).map(l => <option key={l}>{l}</option>)}
              </select>
            </Field>
          </div>
          <Field id="addr" label="Home address" required error={show('address')}>
            <input id="addr" className="ag-tf-input" value={form.address} maxLength={300} onChange={e => set('address', e.target.value)} />
          </Field>
          <Field id="nokn" label="Next of kin" required error={show('nokName')}>
            <input id="nokn" className="ag-tf-input" value={form.nokName} maxLength={100} onChange={e => set('nokName', e.target.value)} />
          </Field>
          <Field id="nokp" label="Next of kin’s phone" required error={show('nokPhone')}>
            <input id="nokp" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="080 0000 0000" value={form.nokPhone} onKeyDown={blockNonDigit} onChange={e => set('nokPhone', digitsOnly(e.target.value))} />
          </Field>
        </section>
      )}

      {step === 2 && (
        <section className="ui-card ag-flow-block">
          <dl className="ag-set-rows">
            <div><dt>Customer</dt><dd>{name}</dd></div>
            <div><dt>NIN</dt><dd>{form.nin}</dd></div>
            {form.bvn && <div><dt>BVN</dt><dd>{form.bvn}</dd></div>}
            <div><dt>Address</dt><dd>{[form.address, form.lga, form.state].join(', ')}</dd></div>
            <div><dt>Next of kin</dt><dd>{form.nokName}<br />{form.nokPhone}</dd></div>
          </dl>
          <div className="ui-banner ui-banner--warn ag-upg-warn">
            <p><strong>If the office approves</strong>, {name} stops being your customer. Their savings account closes, and they sign in to the agent app with the same phone number and password to upload their own documents.</p>
          </div>
        </section>
      )}

      <FormError message={error} />
      {blockers.length > 0 && <ul className="ag-upg-list">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}

      <div className="ag-upg-nav">
        {step === 2 && <button type="button" className="ui-btn ui-btn--secondary" disabled={sending} onClick={() => { setError(''); setStep(1) }}>Back</button>}
        {step === 2
          ? <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" disabled={sending} onClick={send}>{sending ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : requestId ? 'Send again' : 'Send request'}</button>
          : <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={next}>Continue</button>}
      </div>
    </div>
  )
}

function Field({ id, label, required, hint, error, children }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}{required && <span className="ag-req" aria-hidden="true"> *</span>}</label>
        {children}
      </div>
      {error ? <FieldError id={`${id}-error`} message={error} /> : hint ? <p className="ag-fineprint">{hint}</p> : null}
    </div>
  )
}
