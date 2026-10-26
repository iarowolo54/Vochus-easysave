'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { blockMinus, blockNonDigit, digitsOnly, nonNegativeString } from '@/lib/numeric'

interface SubAgent { id: string; name: string; phone: string; location: string; walletBalance: number; createdAt: string; photoUrl?: string | null }

export default function SubAgentsPage() {
  const { update } = useSession()
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [fundModal, setFundModal] = useState<SubAgent | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [fundAmount, setFundAmount] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const res = await fetch('/api/subagents')
    const data = await res.json()
    setSubAgents(data.subAgents ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function fund() {
    if (!fundModal || !fundAmount) { setError('Enter amount'); return }
    setSubmitting(true); setError('')
    const res = await fetch(`/api/subagents/${fundModal.id}/fund`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(fundAmount) }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSubmitting(false); return }
    setToast(`₦${parseFloat(fundAmount).toLocaleString()} allocated to ${fundModal.name}`)
    setFundModal(null); setFundAmount('')
    setSubmitting(false)
    update()
    load()
    setTimeout(() => setToast(''), 4000)
  }

  async function addSubAgent() {
    if (!newName || !newPhone || !newLocation) { setError('All fields required'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/subagents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, phone: newPhone, location: newLocation }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSubmitting(false); return }
    setToast(`${newName} registered as sub-agent`)
    setAddModal(false); setNewName(''); setNewPhone(''); setNewLocation('')
    setSubmitting(false)
    load()
    setTimeout(() => setToast(''), 4000)
  }

  const totalAllocated = subAgents.reduce((s, a) => s + a.walletBalance, 0)
  const avColors = ['av-b', 'av-g', 'av-gd', 'av-rd', 'av-pu']

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><h2>Sub-Agents</h2><p>Manage agents under your supervision</p></div>
        <button className="btn btn-b" onClick={() => setAddModal(true)}>+ Register Sub-Agent</button>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <div className="stat-card blue">
          <div className="stat-icon" style={{ background: 'var(--bl)' }}>🤝</div>
          <div className="stat-lbl">Sub-Agents</div>
          <div className="stat-val">{subAgents.length}</div>
          <div className="stat-sub">Registered</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon" style={{ background: 'var(--gdl)' }}>💸</div>
          <div className="stat-lbl">Total Allocated</div>
          <div className="stat-val">₦{totalAllocated.toLocaleString()}</div>
          <div className="stat-sub">Across all sub-agents</div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 24 }}>Loading…</div>}

      {!loading && (
        <div className="grid g3" style={{ marginBottom: 18 }}>
          {subAgents.map((a, i) => (
            <div key={a.id} className="sa-card">
              <div className={`av ${avColors[i % avColors.length]}`} style={{ width: 44, height: 44, fontSize: 14, overflow: 'hidden', padding: 0 }}>
                {a.photoUrl
                  ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : a.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              <div className="sa-meta">
                <div className="sa-name">{a.name}</div>
                <div className="sa-sub">{a.phone} · {a.location}</div>
                <span className="bdg bdg-g" style={{ marginTop: 4, display: 'inline-flex' }}>Active</span>
              </div>
              <div>
                <div className="sa-bal">₦{a.walletBalance.toLocaleString()}</div>
                <button className="btn btn-b btn-sm" style={{ marginTop: 6 }} onClick={() => { setFundModal(a); setError('') }}>Fund</button>
              </div>
            </div>
          ))}
          {subAgents.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--mu)', padding: 24 }}>No sub-agents yet. Click &quot;Register Sub-Agent&quot; to add one.</div>
          )}
        </div>
      )}

      {fundModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 400, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Fund {fundModal.name}</div>
              <button className="btn btn-out btn-sm" onClick={() => { setFundModal(null); setFundAmount(''); setError('') }}>✕</button>
            </div>
            {error && <div className="alert alert-rd" style={{ marginBottom: 12 }}>🔴 {error}</div>}
            <div className="conf-table" style={{ marginBottom: 14 }}>
              <div className="conf-row"><span className="conf-lbl">Sub-Agent</span><strong>{fundModal.name}</strong></div>
              <div className="conf-row"><span className="conf-lbl">Current Balance</span><strong style={{ color: 'var(--g)' }}>₦{fundModal.walletBalance.toLocaleString()}</strong></div>
            </div>
            <label className="flabel">Amount to Allocate (₦) *</label>
            <input className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="Enter amount" value={fundAmount} onChange={e => setFundAmount(nonNegativeString(e.target.value))} style={{ marginBottom: 14 }} />
            <div className="btn-row">
              <button className="btn btn-out" onClick={() => { setFundModal(null); setFundAmount('') }}>Cancel</button>
              <button className="btn btn-b" disabled={submitting} onClick={fund}>
                {submitting ? '⏳ Allocating…' : '💸 Allocate Funds'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 420, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Register Sub-Agent</div>
              <button className="btn btn-out btn-sm" onClick={() => { setAddModal(false); setError('') }}>✕</button>
            </div>
            {error && <div className="alert alert-rd" style={{ marginBottom: 12 }}>🔴 {error}</div>}
            <div className="form-row"><label className="flabel">Full Name *</label><input className="finput" placeholder="Kemi Adebisi" value={newName} onChange={e => setNewName(e.target.value)} /></div>
            <div className="form-row"><label className="flabel">Phone *</label><input className="finput" type="tel" inputMode="numeric" maxLength={11} placeholder="080XXXXXXXX" value={newPhone} onKeyDown={blockNonDigit} onChange={e => setNewPhone(digitsOnly(e.target.value).slice(0, 11))} /></div>
            <div className="form-row"><label className="flabel">Location *</label><input className="finput" placeholder="e.g. Yaba, Lagos" value={newLocation} onChange={e => setNewLocation(e.target.value)} /></div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-out" onClick={() => { setAddModal(false); setNewName(''); setNewPhone(''); setNewLocation('') }}>Cancel</button>
              <button className="btn btn-b" disabled={submitting} onClick={addSubAgent}>
                {submitting ? '⏳ Registering…' : '✓ Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
