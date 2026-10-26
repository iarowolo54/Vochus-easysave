'use client'
import { useEffect, useState } from 'react'

interface RewardPromo {
  id: string; name: string; startDate: string; endDate: string
  offlineRewardAmount: number; onlineRewardAmount: number; isActive: boolean; createdAt: string
}

interface AgentReward {
  id: string; agentId: string; customerId: string; type: string; amount: number
  narration: string; createdAt: string
  agent: { name: string; agentId: string }
  customer: { firstName: string; lastName: string; customerId: string }
  promo: { name: string }
}

function fmt(n: number) { return `₦${n.toLocaleString()}` }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
function isoDate(s: string) { return s ? new Date(s).toISOString().slice(0, 10) : '' }

export default function RewardsPage() {
  const [promos, setPromos] = useState<RewardPromo[]>([])
  const [rewards, setRewards] = useState<AgentReward[]>([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPromo, setEditPromo] = useState<RewardPromo | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [form, setForm] = useState({
    name: 'Registration Reward', startDate: '', endDate: '',
    offlineRewardAmount: '200', onlineRewardAmount: '500',
  })

  function load() {
    setLoading(true)
    fetch('/api/admin/rewards').then(r => r.json()).then(d => {
      setPromos(d.promos ?? [])
      setRewards(d.rewards ?? [])
      setTotalAmount(d.totalAmount ?? 0)
      setTotalCount(d.totalCount ?? 0)
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(load, [])

  function openNew() {
    setEditPromo(null)
    setForm({ name: 'Registration Reward', startDate: '', endDate: '', offlineRewardAmount: '200', onlineRewardAmount: '500' })
    setErr('')
    setShowForm(true)
  }

  function openEdit(p: RewardPromo) {
    setEditPromo(p)
    setForm({
      name: p.name,
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
      offlineRewardAmount: String(p.offlineRewardAmount),
      onlineRewardAmount: String(p.onlineRewardAmount),
    })
    setErr('')
    setShowForm(true)
  }

  async function savePromo() {
    if (!form.startDate || !form.endDate) { setErr('Start and end dates required'); return }
    setSaving(true); setErr('')
    try {
      const url = editPromo ? `/api/admin/rewards/${editPromo.id}` : '/api/admin/rewards'
      const method = editPromo ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Failed'); setSaving(false); return }
      setMsg(editPromo ? 'Promo updated.' : 'Promo created.')
      setShowForm(false)
      load()
    } catch { setErr('Network error') }
    setSaving(false)
  }

  async function toggleActive(p: RewardPromo) {
    await fetch(`/api/admin/rewards/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    })
    load()
  }

  async function deletePromo(p: RewardPromo) {
    if (!confirm(`Delete promo "${p.name}"? This cannot be undone.`)) return
    await fetch(`/api/admin/rewards/${p.id}`, { method: 'DELETE' })
    load()
  }

  const activePromo = promos.find(p => p.isActive)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      {msg && <div style={{ background: 'var(--gl)', color: 'var(--g)', padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 4 }}>TOTAL REWARDS CREDITED</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--g)' }}>{fmt(totalAmount)}</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 4 }}>TOTAL REWARDS ISSUED</div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>{totalCount}</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 4 }}>ACTIVE PROMO</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: activePromo ? 'var(--g)' : 'var(--mu)' }}>
            {activePromo ? activePromo.name : 'None'}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>Reward Promos</div>
          <button className="btn btn-g" onClick={openNew} style={{ fontSize: 13 }}>+ New Promo</button>
        </div>

        {showForm && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--br)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{editPromo ? 'Edit Promo' : 'New Promo'}</div>
            {err && <div style={{ color: 'var(--rd)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <div className="a-form-row">
              <label>Promo Name</label>
              <input className="a-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Registration Reward" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
              <div className="a-form-row">
                <label>Start Date</label>
                <input className="a-input" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="a-form-row">
                <label>End Date</label>
                <input className="a-input" type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="a-form-row">
                <label>Offline Reg. Reward (₦)</label>
                <input className="a-input" type="number" value={form.offlineRewardAmount} onChange={e => setForm(f => ({ ...f, offlineRewardAmount: e.target.value }))} placeholder="500" />
                <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 4 }}>Agent enrolls customer via agent app</div>
              </div>
              <div className="a-form-row">
                <label>Online Reg. Reward (₦)</label>
                <input className="a-input" type="number" value={form.onlineRewardAmount} onChange={e => setForm(f => ({ ...f, onlineRewardAmount: e.target.value }))} placeholder="200" />
                <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 4 }}>Customer self-enrolls via referral link</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-out" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-g" onClick={savePromo} disabled={saving}>{saving ? 'Saving…' : editPromo ? 'Update' : 'Create'}</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--mu)', fontSize: 13 }}>Loading…</div>
        ) : promos.length === 0 ? (
          <div style={{ color: 'var(--mu)', fontSize: 13, textAlign: 'center', padding: 24 }}>No promos yet. Create one to start rewarding agents.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--br)' }}>
                  {['Promo Name', 'Period', 'Offline', 'Online', 'Status', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700, color: 'var(--mu)', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {promos.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--br)' }}>
                    <td style={{ padding: '10px 10px', fontWeight: 700 }}>{p.name}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--mu)' }}>{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--g)', fontWeight: 700 }}>{fmt(p.offlineRewardAmount)}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--g)', fontWeight: 700 }}>{fmt(p.onlineRewardAmount)}</td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{ background: p.isActive ? 'var(--gl)' : 'var(--bg)', color: p.isActive ? 'var(--g)' : 'var(--mu)', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-out" onClick={() => openEdit(p)} style={{ fontSize: 11, padding: '4px 10px' }}>Edit</button>
                        <button className="btn btn-out" onClick={() => toggleActive(p)} style={{ fontSize: 11, padding: '4px 10px' }}>{p.isActive ? 'Deactivate' : 'Activate'}</button>
                        <button onClick={() => deletePromo(p)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--rd)', background: 'var(--rdl)', color: 'var(--rd)', cursor: 'pointer', fontWeight: 700 }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Recent Reward History</div>
        {rewards.length === 0 ? (
          <div style={{ color: 'var(--mu)', fontSize: 13, textAlign: 'center', padding: 24 }}>No rewards issued yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--br)' }}>
                  {['Date', 'Agent', 'Customer', 'Type', 'Amount', 'Promo'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700, color: 'var(--mu)', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rewards.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--br)' }}>
                    <td style={{ padding: '10px 10px', color: 'var(--mu)' }}>{fmtDate(r.createdAt)}</td>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ fontWeight: 700 }}>{r.agent.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--mu)' }}>{r.agent.agentId}</div>
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <div>{r.customer.firstName} {r.customer.lastName}</div>
                      <div style={{ fontSize: 11, color: 'var(--mu)' }}>{r.customer.customerId}</div>
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{ background: r.type === 'online' ? '#e8f0fe' : 'var(--gl)', color: r.type === 'online' ? '#1a73e8' : 'var(--g)', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                        {r.type === 'online' ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--g)' }}>{fmt(r.amount)}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--mu)', fontSize: 12 }}>{r.promo.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
