'use client'

import { useState, useEffect } from 'react'

interface Report {
  id: string; category: string; title: string; description: string; status: string; createdAt: string
}

export default function ReportPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('Transaction Dispute')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const res = await fetch('/api/reports')
    const data = await res.json()
    setReports(data.reports ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function submit() {
    if (!title || !description) { setError('Title and description are required'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, title, description }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSubmitting(false); return }
    setToast('Report submitted successfully. We will respond within 24 hours.')
    setTitle(''); setDescription('')
    setSubmitting(false)
    load()
    setTimeout(() => setToast(''), 5000)
  }

  const statusBadge = (s: string) => s === 'Open' ? 'bdg-rd' : s === 'In Review' ? 'bdg-gd' : 'bdg-ok'
  const openCount = reports.filter(r => r.status !== 'Resolved').length

  return (
    <>
      <div className="page-header">
        <h2>Report Issue</h2>
        <p>Submit a complaint or flag a problem to customer support</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-title">New Report</div>
          <div className="form-row fr2">
            <div><label className="flabel">Category *</label>
              <select className="finput" value={category} onChange={e => setCategory(e.target.value)}>
                <option>Transaction Dispute</option>
                <option>Customer Complaint</option>
                <option>Card Problem</option>
                <option>System Error</option>
                <option>Wallet Funding Issue</option>
                <option>Other</option>
              </select>
            </div>
            <div><label className="flabel">Title *</label>
              <input className="finput" placeholder="Brief title" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          </div>
          <label className="flabel">Description *</label>
          <textarea
            className="finput" rows={5} placeholder="Describe the issue clearly…"
            value={description} onChange={e => setDescription(e.target.value)}
          />
          <div className="alert alert-b" style={{ marginTop: 14 }}>ℹ️ Customer care will respond within 24 hours via SMS and email.</div>
          <button className="btn btn-rd" style={{ marginTop: 4 }} disabled={submitting} onClick={submit}>
            {submitting ? '⏳ Submitting…' : '🚨 Submit Report'}
          </button>
        </div>
        <div>
          <div className="card">
            <div className="card-title">Your Reports {openCount > 0 && <span className="nav-badge" style={{ marginLeft: 8 }}>{openCount}</span>}</div>
            {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 12 }}>Loading…</div>}
            {!loading && reports.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 12 }}>No reports yet</div>
            )}
            {!loading && reports.map((r, i) => (
              <div key={r.id} className="cust-row" style={{ padding: '9px 0', borderBottom: i < reports.length - 1 ? undefined : 'none' }}>
                <div className={`av ${r.status === 'Resolved' ? 'av-g' : 'av-gd'}`}>
                  {r.status === 'Resolved' ? '✅' : '⏳'}
                </div>
                <div>
                  <div className="cust-name">{r.title || r.category}</div>
                  <div className="cust-sub">
                    {r.category} · {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <span className={`bdg ${statusBadge(r.status)}`} style={{ marginLeft: 'auto' }}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
