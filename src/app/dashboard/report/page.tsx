'use client'

import { useState, useEffect, useCallback } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatTime } from '@/lib/format'

interface Report {
  id: string; category: string; title: string; description: string; status: string; createdAt: string
}

const CATEGORIES = ['Transaction Dispute', 'Customer Complaint', 'Card Problem', 'System Error', 'Wallet Funding Issue', 'Other']
/** What to put in the description, per category, so support can act without asking again. */
const PROMPTS: Record<string, string> = {
  'Transaction Dispute': 'Include the transaction reference (TXN-…), the customer, the amount, and what went wrong.',
  'Customer Complaint': 'Include the customer’s name or ID and what they’re unhappy about.',
  'Card Problem': 'Include the card serial or customer ID and what the card is doing.',
  'System Error': 'Say which screen you were on, what you tapped, and any message you saw.',
  'Wallet Funding Issue': 'Include the amount, the time you paid, and the payment reference if you have it.',
  Other: 'Tell us what happened and what you expected.',
}
const FILTERS = ['All', 'Open', 'In Review', 'Resolved'] as const
const TITLE_MAX = 80
const DESC_MIN = 20
const DESC_MAX = 1000

const statusTag = (s: string) => s === 'Resolved' ? 'ag-crow-tag--ok' : s === 'In Review' ? 'ag-crow-tag--soon' : 'ag-crow-tag--due'
const statusIcon = (s: string) => s === 'Resolved' ? Icons.check : s === 'In Review' ? Icons.pending : Icons.report

const PAGE_SIZE = 30

export default function ReportPage() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [touched, setTouched] = useState({ title: false, description: false })
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All')
  const [open, setOpen] = useState<Report | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reports')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReports(data.reports ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
      setReports(prev => prev ?? [])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const titleError = !title.trim() ? 'Give it a short summary' : ''
  const descError = !description.trim() ? 'Describe what happened'
    : description.trim().length < DESC_MIN ? `Add a bit more detail (at least ${DESC_MIN} characters)` : ''

  async function submit() {
    setTouched({ title: true, description: true })
    if (titleError || descError) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, title: title.trim(), description: description.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Your report didn’t go through. Please try again.'); return }
      setToast('Report sent to support')
      setTitle(''); setDescription(''); setTouched({ title: false, description: false })
      setFilter('All')
      load()
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const counts = Object.fromEntries(FILTERS.map(f => [f, f === 'All' ? (reports?.length ?? 0) : (reports ?? []).filter(r => r.status === f).length]))
  const shown = (reports ?? []).filter(r => filter === 'All' || r.status === filter)
  const showTitleError = touched.title && titleError
  const showDescError = touched.description && descError

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head"><h2 id="new-report">Report a problem</h2></div>
          <section className="ui-card ag-report-form" aria-labelledby="new-report">
            <p className="ag-label" id="cat-label">What is it about?</p>
            <div className="ag-goal-chips" role="group" aria-labelledby="cat-label">
              {CATEGORIES.map(c => (
                <button key={c} type="button" aria-pressed={category === c} className="ag-chip" onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>

            <div className="ag-tf-wrap">
              <div className={`ag-tf${showTitleError ? ' is-invalid' : ''}`}>
                <label className="ag-tf-label" htmlFor="rp-title">Summary</label>
                <input id="rp-title" className="ag-tf-input" maxLength={TITLE_MAX} placeholder="e.g. Customer charged twice for one saving"
                  value={title} aria-invalid={showTitleError ? true : undefined} aria-describedby="rp-title-note"
                  onChange={e => setTitle(e.target.value)} onBlur={() => setTouched(t => ({ ...t, title: true }))} />
              </div>
              {showTitleError
                ? <FieldError id="rp-title-note" message={titleError} />
                : <p className="ag-fineprint ag-count" id="rp-title-note">{title.length}/{TITLE_MAX}</p>}
            </div>

            <div className="ag-tf-wrap">
              <div className={`ag-tf${showDescError ? ' is-invalid' : ''}`}>
                <label className="ag-tf-label" htmlFor="rp-desc">What happened</label>
                <textarea id="rp-desc" className="ag-tf-input ag-tf-area" rows={5} maxLength={DESC_MAX} placeholder="Describe the problem…"
                  value={description} aria-invalid={showDescError ? true : undefined} aria-describedby="rp-desc-note"
                  onChange={e => setDescription(e.target.value)} onBlur={() => setTouched(t => ({ ...t, description: true }))} />
              </div>
              {showDescError
                ? <FieldError id="rp-desc-note" message={descError} />
                : <p className="ag-fineprint" id="rp-desc-note">{PROMPTS[category]}</p>}
            </div>

            <FormError message={error} />
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={submitting} onClick={submit}>
              {submitting ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : <><Icons.send size={18} aria-hidden="true" /> Send report</>}
            </button>
            <p className="ui-note ui-note--center">Support reviews every report. Its status updates here as they work on it.</p>
          </section>
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Your reports</h2>{reports && reports.length > 0 && <span className="ui-card-meta">{reports.length}</span>}</div>
          {reports && reports.length > 0 && (
            <div className="ag-tx-chips ag-report-filters" role="group" aria-label="Filter reports">
              {FILTERS.map(f => (
                <button key={f} type="button" className="ag-chip" aria-pressed={filter === f} onClick={() => { setFilter(f); setLimit(PAGE_SIZE) }}>
                  {f === 'In Review' ? 'In review' : f} <span className="ag-chip-count">{counts[f]}</span>
                </button>
              ))}
            </div>
          )}
          {reports === null ? (
            <ListSkeleton count={4} />
          ) : failed && reports.length === 0 ? (
            <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your reports" text="Check your connection and try again."
              action={<button type="button" className="ui-btn ui-btn--secondary" onClick={() => { setReports(null); load() }}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} /></section>
          ) : shown.length === 0 ? (
            <section className="ui-card"><EmptyState icon="report" title={reports.length === 0 ? 'No reports yet' : `Nothing ${filter === 'In Review' ? 'in review' : filter.toLowerCase()}`}
              text={reports.length === 0 ? 'Problems you report show here, with their status.' : 'Try another filter.'} /></section>
          ) : (
            <>
            <section className="ui-card ui-card--list">
              {shown.slice(0, limit).map(r => {
                const Icon = statusIcon(r.status)
                return (
                  <button key={r.id} type="button" className="ag-crow" onClick={() => setOpen(r)}>
                    <span className={`ag-report-icon ag-report-icon--${r.status === 'Resolved' ? 'ok' : r.status === 'In Review' ? 'review' : 'open'}`} aria-hidden="true"><Icon size={18} /></span>
                    <span className="ag-crow-main">
                      <span className="ag-crow-name">{r.title || r.category}</span>
                      <span className="ag-crow-sub">{r.category} · {formatDate(r.createdAt)}</span>
                    </span>
                    <span className="ag-crow-end"><span className={`ag-crow-tag ${statusTag(r.status)}`}>{r.status === 'In Review' ? 'In review' : r.status}</span></span>
                  </button>
                )
              })}
            </section>
            {shown.length > limit && <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => setLimit(n => n + PAGE_SIZE)}>
                Show more ({shown.length - limit} older)
              </button>}
            </>
          )}
        </div>
      </div>

      <BottomSheet open={!!open} onClose={() => setOpen(null)} title={open?.title || 'Report'}>
        {open && (
          <>
            <div className="ag-report-meta">
              <span className={`ag-crow-tag ${statusTag(open.status)}`}>{open.status === 'In Review' ? 'In review' : open.status}</span>
              <span className="ui-row-sub">{open.category} · {formatDate(open.createdAt)}, {formatTime(open.createdAt)}</span>
            </div>
            <p className="ag-report-body">{open.description}</p>
            <p className="ag-fineprint">
              {open.status === 'Resolved' ? 'Support has marked this as resolved.' : open.status === 'In Review' ? 'Support is looking into this.' : 'Waiting for support to pick this up.'}
            </p>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
