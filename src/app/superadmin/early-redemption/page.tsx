'use client'

import { useState, useEffect, useCallback } from 'react'

interface RedemptionRecord {
  id: string
  ref: string
  type: string
  reason: string
  note: string | null
  status: string
  balance: number
  penalty: number
  netPayout: number
  token: string | null
  tokenExpiry: string | null
  payoutMethod: string
  accountNumber: string | null
  accountName: string | null
  bankName: string | null
  bankTransferStatus: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  savingsPlanId: string
  planStatus: string
}

interface PageData {
  pending: number
  approved: number
  rejected: number
  tokensToday: number
  records: RedemptionRecord[]
}

interface CompletedRedemption {
  id: string
  ref: string
  amount: number
  customerName: string | null
  customerId: string | null
  agentName: string
  agentId: string
  method: string | null
  status: string
  createdAt: string
}

interface CompletedStats {
  totalRedemptions: number
  totalRedeemedAmount: number
  todayCount: number
  todayAmount: number
}

const REASONS = [
  'Medical emergency',
  'Family bereavement',
  'Job loss / financial hardship',
  'School fees / education',
  'Business emergency',
  'Customer request — personal',
  'Other (see note)',
]

export default function RedemptionsPage() {
  const [data, setData] = useState<PageData>({ pending: 0, approved: 0, rejected: 0, tokensToday: 0, records: [] })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'completed' | 'history'>('pending')
  const [toast, setToast] = useState('')
  const [deciding, setDeciding] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [plans, setPlans] = useState<{ id: string; customerName: string; customerId: string; balance: number; status: string; periodDays: number; dailyAmount: number; cadence: string }[]>([])
  const [form, setForm] = useState({ savingsPlanId: '', type: 'early', reason: '', note: '' })
  const [preview, setPreview] = useState<{ balance: number; savingsFee?: number; penalty: number; netPayout: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [pinModal, setPinModal] = useState<{ id: string; ref: string; customerName: string; amount: number; payoutMethod: string; accountName: string | null; bankName: string | null; accountNumber: string | null } | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [otpModal, setOtpModal] = useState<{ id: string; ref: string; customerName: string } | null>(null)
  const [otpValue, setOtpValue] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)

  const [detailRecord, setDetailRecord] = useState<RedemptionRecord | null>(null)

  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all')
  const [completedPage, setCompletedPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const PAGE_SIZE = 25

  const [completed, setCompleted] = useState<CompletedRedemption[]>([])
  const [completedStats, setCompletedStats] = useState<CompletedStats>({ totalRedemptions: 0, totalRedeemedAmount: 0, todayCount: 0, todayAmount: 0 })
  const [completedSearch, setCompletedSearch] = useState('')
  const [completedDate, setCompletedDate] = useState('')
  const [completedLoading, setCompletedLoading] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/early-redemption')
    if (res.ok) { const d = await res.json(); setData(d) }
    setLoading(false)
  }, [])

  const loadCompleted = useCallback(async () => {
    setCompletedLoading(true)
    const params = new URLSearchParams()
    if (completedSearch) params.set('search', completedSearch)
    if (completedDate) params.set('date', completedDate)
    const res = await fetch(`/api/admin/redemptions?${params}`)
    const d = res.ok ? await res.json() : {}
    setCompleted(d.redemptions ?? [])
    setCompletedPage(1)
    setCompletedStats({
      totalRedemptions: d.totalRedemptions ?? 0,
      totalRedeemedAmount: d.totalRedeemedAmount ?? 0,
      todayCount: d.todayCount ?? 0,
      todayAmount: d.todayAmount ?? 0,
    })
    setCompletedLoading(false)
  }, [completedSearch, completedDate])

  const loadPlans = useCallback(async () => {
    const res = await fetch('/api/admin/savings?status=Active&page=1&limit=100')
    if (res.ok) {
      const d = await res.json()
      setPlans((d.plans ?? []).map((p: { id: string; customerName: string; customerId: string; balance: number; status: string; periodDays: number; dailyAmount: number; cadence: string }) => ({
        id: p.id, customerName: p.customerName, customerId: p.customerId, balance: p.balance, status: p.status, periodDays: p.periodDays, dailyAmount: p.dailyAmount, cadence: p.cadence,
      })))
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'completed') loadCompleted() }, [tab, loadCompleted])

  function calcPreview(planId: string) {
    const plan = plans.find(p => p.id === planId)
    if (!plan) { setPreview(null); return }
    const isDaily = !plan.cadence || plan.cadence === 'daily'
    const savingsFee = isDaily
      ? Math.min(Math.round(plan.dailyAmount * ((plan.periodDays || 31) / 31) * 100) / 100, plan.balance)
      : Math.min(Math.round(plan.balance * 0.20 * 100) / 100, plan.balance)
    const netPayout = Math.round((plan.balance - savingsFee) * 100) / 100
    setPreview({ balance: plan.balance, savingsFee, penalty: 0, netPayout })
  }

  function onFormChange(key: keyof typeof form, val: string) {
    const next = { ...form, [key]: val }
    setForm(next)
    if (key === 'savingsPlanId' || key === 'type') calcPreview(next.savingsPlanId)
  }

  async function handleSubmit() {
    if (!form.savingsPlanId || !form.reason) return
    setSubmitting(true)
    const res = await fetch('/api/admin/early-redemption', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (res.ok) {
      setShowModal(false)
      setForm({ savingsPlanId: '', type: 'early', reason: '', note: '' })
      setPreview(null)
      showToast('✅ Redemption request created')
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      showToast((d as { error?: string }).error ?? 'Failed to create request')
    }
  }

  async function decide(id: string, action: 'approve' | 'reject', record?: RedemptionRecord) {
    if (action === 'approve' && record) {
      setPinModal({ id, ref: record.ref, customerName: record.customerName, amount: record.netPayout, payoutMethod: record.payoutMethod ?? 'Cash', accountName: record.accountName ?? null, bankName: record.bankName ?? null, accountNumber: record.accountNumber ?? null })
      setPinValue('')
      setPinError('')
      return
    }
    setDeciding(id + action)
    const res = await fetch(`/api/admin/early-redemption/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setDeciding(null)
    if (res.ok) {
      showToast('❌ Request rejected')
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      showToast((d as { error?: string }).error ?? 'Action failed')
    }
  }

  async function confirmApprove() {
    if (!pinModal) return
    if (!pinValue.trim()) { setPinError('Enter your approval PIN'); return }
    setPinLoading(true); setPinError('')
    const res = await fetch(`/api/admin/early-redemption/${pinModal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', pin: pinValue }),
    })
    setPinLoading(false)
    if (res.ok) {
      const d = await res.json().catch(() => ({}))
      const pending = pinModal
      setPinModal(null); setPinValue('')
      if (d.status === 'AwaitingOTP') {
        setOtpModal({ id: pending.id, ref: pending.ref, customerName: pending.customerName })
        showToast('📩 Paystack sent an OTP to your admin phone — enter it to finish the payout')
        load()
        return
      }
      const isBankTransfer = pending?.payoutMethod === 'Bank Transfer'
      if (isBankTransfer) {
        const status = d.bankTransferStatus
        showToast(status === 'success' ? '✅ Approved — Paystack transfer sent successfully' : '✅ Approved — Bank transfer initiated, awaiting Paystack confirmation')
      } else {
        showToast('✅ Redemption approved — wallets updated')
      }
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      setPinError((d as { error?: string }).error ?? 'Approval failed')
    }
  }

  async function submitOtp() {
    if (!otpModal) return
    if (!otpValue.trim()) { setOtpError('Enter the OTP Paystack sent you'); return }
    setOtpLoading(true); setOtpError('')
    const res = await fetch(`/api/admin/early-redemption/${otpModal.id}/finalize-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: otpValue.trim() }),
    })
    setOtpLoading(false)
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      setOtpModal(null); setOtpValue('')
      showToast('✅ OTP accepted — Paystack transfer completed')
      load()
    } else {
      setOtpError((d as { error?: string }).error ?? 'OTP finalisation failed')
    }
  }

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 8 }}>{title}</div>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
      </div>
    )
  }
  function Row({ label, value, bold, mono, red, green }: { label: string; value: string; bold?: boolean; mono?: boolean; red?: boolean; green?: boolean }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, fontFamily: mono ? 'monospace' : 'inherit', color: red ? 'var(--red)' : green ? 'var(--green)' : 'var(--text)', textAlign: 'right' }}>{value}</span>
      </div>
    )
  }

  const PENDING_STATUSES = ['Pending', 'TokenValidated', 'AgentApproved', 'AwaitingOTP']
  const pending = data.records.filter(r => PENDING_STATUSES.includes(r.status))
  const history = data.records.filter(r => !PENDING_STATUSES.includes(r.status)).filter(r => {
    if (historyTypeFilter !== 'all' && r.type !== historyTypeFilter) return false
    if (historyStatusFilter !== 'all' && r.status.toLowerCase() !== historyStatusFilter) return false
    if (historySearch && !r.customerName.toLowerCase().includes(historySearch.toLowerCase()) &&
      !r.ref.toLowerCase().includes(historySearch.toLowerCase()) &&
      !r.agentName.toLowerCase().includes(historySearch.toLowerCase())) return false
    return true
  })

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Redemptions</h1>
          <p>Tokenized approval queue and completed payout history</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={() => showToast('📥 Export redemption log')}>↓ Export</button>
          <button className="btn btn-primary btn-sm" onClick={() => { loadPlans(); setShowModal(true) }}>＋ New Request</button>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 22 }}>
        <div className="stat"><span className="stat-ic">⏳</span><div className="stat-lbl">Pending Approval</div><div className="stat-val amber">{data.pending}</div><div className="stat-sub">Awaiting super admin action</div></div>
        <div className="stat"><span className="stat-ic">🔑</span><div className="stat-lbl">Tokens Generated Today</div><div className="stat-val blue">{data.tokensToday}</div><div className="stat-sub">Active &amp; expired</div></div>
        <div className="stat"><span className="stat-ic">✅</span><div className="stat-lbl">Approved</div><div className="stat-val green">{data.approved}</div><div className="stat-sub">All time</div></div>
        <div className="stat"><span className="stat-ic">❌</span><div className="stat-lbl">Rejected</div><div className="stat-val red">{data.rejected}</div><div className="stat-sub">Insufficient reason</div></div>
      </div>

      <div className="tab-bar">
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => setTab('pending')}>⏳ Pending ({pending.length})</button>
        <button className={`tab${tab === 'completed' ? ' active' : ''}`} onClick={() => setTab('completed')}>✅ Completed Payouts</button>
        <button className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>📋 All Requests</button>
      </div>

      {/* Pending */}
      {tab === 'pending' && (
        <div className="card">
          <div className="card-hd">
            <h3>Pending Redemption Requests</h3>
            <span className="bdg bdg-a">{pending.length} awaiting</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token Ref</th><th>Customer</th><th>Agent</th><th>Type</th>
                  <th>Net Payout</th><th>Payout Method</th>
                  <th>Reason</th><th>Requested</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
                {!loading && pending.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No pending requests</td></tr>}
                {!loading && pending.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setDetailRecord(r) }}>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 12, color: 'var(--blue)' }}>{r.ref}</td>
                    <td>
                      <div className="td-name">{r.customerName}</div>
                      <div className="td-sub">{r.customerId}</div>
                    </td>
                    <td>
                      <div className="td-name">{r.agentName}</div>
                      <div className="td-sub">{r.agentId}</div>
                    </td>
                    <td><span className={`bdg ${r.type === 'early' ? 'bdg-a' : 'bdg-b'}`}>{r.type === 'early' ? 'Early Exit' : 'Post-Maturity'}</span></td>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, color: 'var(--green)' }}>{fmt(r.netPayout)}</td>
                    <td>
                      <div style={{ fontSize: 12 }}>
                        <span className={`bdg ${r.payoutMethod === 'Bank Transfer' ? 'bdg-b' : 'bdg-g'}`}>{r.payoutMethod ?? 'Cash'}</span>
                        {r.payoutMethod === 'Bank Transfer' && r.bankName && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                            {r.accountName}<br />{r.bankName} · ****{r.accountNumber?.slice(-4)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(r.requestedAt)}</td>
                    <td>
                      {r.status === 'TokenValidated' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                          <span className="bdg bdg-a" style={{ fontSize: 10 }}>⏳ Awaiting Agent</span>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button className="btn btn-xs btn-green"
                              disabled={deciding === r.id + 'approve'}
                              onClick={() => decide(r.id, 'approve', r)}>
                              {deciding === r.id + 'approve' ? '…' : '✅ Approve'}
                            </button>
                            <button className="btn btn-xs btn-danger"
                              disabled={deciding === r.id + 'reject'}
                              onClick={() => decide(r.id, 'reject')}>
                              {deciding === r.id + 'reject' ? '…' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      ) : r.status === 'AwaitingOTP' ? (
                        <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span className="bdg bdg-a" style={{ fontSize: 10 }}>📩 Awaiting Paystack OTP</span>
                          <button className="btn btn-xs btn-blue"
                            onClick={() => setOtpModal({ id: r.id, ref: r.ref, customerName: r.customerName })}>
                            Enter OTP →
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-start' }}>
                          {r.status === 'AgentApproved' && <span className="bdg bdg-b" style={{ fontSize: 10 }}>✓ Agent Approved</span>}
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button className="btn btn-xs btn-green"
                              disabled={deciding === r.id + 'approve'}
                              onClick={() => decide(r.id, 'approve', r)}>
                              {deciding === r.id + 'approve' ? '…' : '✅ Approve'}
                            </button>
                            <button className="btn btn-xs btn-danger"
                              disabled={deciding === r.id + 'reject'}
                              onClick={() => decide(r.id, 'reject')}>
                              {deciding === r.id + 'reject' ? '…' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Completed Payouts */}
      {tab === 'completed' && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <div className="stat"><span className="stat-ic">📤</span><div className="stat-lbl">Total Payouts</div><div className="stat-val blue">{completedStats.totalRedemptions.toLocaleString()}</div></div>
            <div className="stat"><span className="stat-ic">💸</span><div className="stat-lbl">Total Amount Paid Out</div><div className="stat-val red">{fmt(completedStats.totalRedeemedAmount)}</div></div>
            <div className="stat"><span className="stat-ic">📅</span><div className="stat-lbl">Today's Count</div><div className="stat-val amber">{completedStats.todayCount}</div></div>
            <div className="stat"><span className="stat-ic">🔻</span><div className="stat-lbl">Today's Amount</div><div className="stat-val red">{fmt(completedStats.todayAmount)}</div></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="a-topbar-search" style={{ minWidth: 240 }}>
                <span style={{ color: 'var(--text3)' }}>🔍</span>
                <input type="text" placeholder="Search ref, customer, agent…" value={completedSearch} onChange={e => setCompletedSearch(e.target.value)} />
              </div>
              <input type="date" value={completedDate} onChange={e => setCompletedDate(e.target.value)} style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }} />
              {(completedSearch || completedDate) && <button className="btn btn-outline btn-sm" onClick={() => { setCompletedSearch(''); setCompletedDate('') }}>Clear</button>}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h3>Completed Payouts</h3>
              <span className="bdg bdg-g">{completed.length} transactions</span>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ref</th><th>Customer</th><th>Agent</th><th>Amount</th><th>Method</th><th>Date</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {completedLoading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
                  {!completedLoading && completed.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No completed payouts</td></tr>}
                  {!completedLoading && completed.slice((completedPage - 1) * PAGE_SIZE, completedPage * PAGE_SIZE).map(r => (
                    <tr key={r.id}>
                      <td><strong style={{ fontSize: 12, color: 'var(--blue)' }}>{r.ref}</strong></td>
                      <td>
                        {r.customerName
                          ? <><div className="td-name">{r.customerName}</div><div className="td-sub">{r.customerId}</div></>
                          : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td>
                        <div className="td-name">{r.agentName}</div>
                        <div className="td-sub">{r.agentId}</div>
                      </td>
                      <td><span style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(r.amount)}</span></td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{r.method ?? '—'}</td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(r.createdAt)}</td>
                      <td><span className="bdg bdg-g">{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            {!completedLoading && Math.ceil(completed.length / PAGE_SIZE) > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(completedPage - 1) * PAGE_SIZE + 1}–{Math.min(completedPage * PAGE_SIZE, completed.length)} of {completed.length}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn btn-xs btn-outline" disabled={completedPage === 1} onClick={() => setCompletedPage(p => p - 1)}>← Prev</button>
                  <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {completedPage} of {Math.ceil(completed.length / PAGE_SIZE)}</span>
                  <button className="btn btn-xs btn-outline" disabled={completedPage === Math.ceil(completed.length / PAGE_SIZE)} onClick={() => setCompletedPage(p => p + 1)}>Next →</button>
                </div>
              </div>
            )}
            </div>
          </div>
        </>
      )}

      {/* All Requests History */}
      {tab === 'history' && (
        <>
          <div className="card" style={{ padding: '14px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" placeholder="🔍  Search customer, token, agent…" value={historySearch} onChange={e => setHistorySearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <select style={{ width: 150 }} value={historyTypeFilter} onChange={e => setHistoryTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                <option value="early">Early Exit</option>
                <option value="matured">Post-Maturity</option>
              </select>
              <select style={{ width: 150 }} value={historyStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value)}>
                <option value="all">All Status</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          <div className="card">
            <div className="card-hd">
              <h3>All Redemption Requests</h3>
              <span className="bdg bdg-b">{history.length} records</span>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr><th>Token Ref</th><th>Customer</th><th>Agent</th><th>Type</th><th>Amount</th><th>Penalty</th><th>Net Payout</th><th>Decision</th><th>Decided By</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {history.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No records</td></tr>}
                  {history.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE).map(r => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRecord(r)}>
                      <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 12, color: 'var(--blue)' }}>{r.ref}</td>
                      <td><div className="td-name">{r.customerName}</div><div className="td-sub">{r.customerId}</div></td>
                      <td><div className="td-name">{r.agentName}</div><div className="td-sub">{r.agentId}</div></td>
                      <td><span className={`bdg ${r.type === 'early' ? 'bdg-a' : 'bdg-b'}`}>{r.type === 'early' ? 'Early Exit' : 'Post-Maturity'}</span></td>
                      <td style={{ fontWeight: 600 }}>{fmt(r.balance)}</td>
                      <td style={{ color: 'var(--text3)' }}>—</td>
                      <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, color: 'var(--green)' }}>{fmt(r.netPayout)}</td>
                      <td><span className={`bdg ${r.status === 'Approved' ? 'bdg-g' : 'bdg-r'}`}>{r.status}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.decidedBy ?? '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.decidedAt ? fmtDate(r.decidedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            {Math.ceil(history.length / PAGE_SIZE) > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(historyPage - 1) * PAGE_SIZE + 1}–{Math.min(historyPage * PAGE_SIZE, history.length)} of {history.length}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn btn-xs btn-outline" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)}>← Prev</button>
                  <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {historyPage} of {Math.ceil(history.length / PAGE_SIZE)}</span>
                  <button className="btn btn-xs btn-outline" disabled={historyPage === Math.ceil(history.length / PAGE_SIZE)} onClick={() => setHistoryPage(p => p + 1)}>Next →</button>
                </div>
              </div>
            )}
            </div>
          </div>
        </>
      )}

      {/* New Request Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r)', padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 17, fontWeight: 700, margin: 0 }}>⏮️ Request Early Redemption</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
            </div>

            <div style={{ background: 'var(--amber-lt)', border: '1px solid var(--amber)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--amber)', marginBottom: 18 }}>
              A one-time security token will be generated and must be validated before processing. Only the platform fee (~3.23%) applies — no early exit penalty.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Customer / Plan</label>
                <select value={form.savingsPlanId} onChange={e => onFormChange('savingsPlanId', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }}>
                  <option value="">— Select Customer —</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.customerName} ({p.customerId}) · {fmt(p.balance)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Redemption Type</label>
                <select value={form.type} onChange={e => onFormChange('type', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }}>
                  <option value="early">Early Exit (Before Maturity)</option>
                  <option value="matured">Post-Maturity Payout</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Reason for Early Withdrawal</label>
              <select value={form.reason} onChange={e => onFormChange('reason', e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }}>
                <option value="">— Select reason —</option>
                {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {(form.reason === 'Other (see note)' || form.note) && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Additional Note</label>
                <textarea value={form.note} onChange={e => onFormChange('note', e.target.value)} rows={2}
                  placeholder="Provide more detail…"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            )}

            {preview && (
              <div style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 10 }}>Payout Preview</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text2)' }}>Gross Balance</span>
                    <strong>{fmt(preview.balance)}</strong>
                  </div>
                  {(preview.savingsFee ?? 0) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--red)' }}>Platform Deduction</span>
                      <strong style={{ color: 'var(--red)' }}>- {fmt(preview.savingsFee ?? 0)}</strong>
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>Net Payout to Customer</span>
                    <strong style={{ color: 'var(--green)', fontFamily: "'IBM Plex Serif', serif", fontSize: 16 }}>{fmt(preview.netPayout)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={submitting || !form.savingsPlanId || !form.reason} onClick={handleSubmit}>
                {submitting ? 'Creating…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>

      {pinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 32, width: 360, boxShadow: '0 24px 60px rgba(0,0,0,.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Approval PIN Required</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
                Approving redemption of <strong style={{ color: 'var(--green)' }}>₦{pinModal.amount.toLocaleString()}</strong> for <strong>{pinModal.customerName}</strong>
              </div>
              {pinModal.payoutMethod === 'Bank Transfer' && pinModal.bankName && (
                <div style={{ marginTop: 12, background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 12, textAlign: 'left' }}>
                  <div style={{ color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.6px', fontSize: 10, fontWeight: 700 }}>💳 Paystack Bank Transfer</div>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{pinModal.accountName}</div>
                  <div style={{ color: 'var(--text2)' }}>{pinModal.bankName} · ****{pinModal.accountNumber?.slice(-4)}</div>
                </div>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'block', marginBottom: 8 }}>Enter PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinValue}
                onChange={e => { setPinValue(e.target.value); setPinError('') }}
                onKeyDown={e => e.key === 'Enter' && confirmApprove()}
                autoFocus
                placeholder="••••"
                style={{ width: '100%', padding: '14px 16px', border: `2px solid ${pinError ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, fontSize: 24, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', background: 'var(--surface2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
              />
              {pinError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>{pinError}</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setPinModal(null); setPinValue(''); setPinError('') }}>Cancel</button>
              <button className="btn btn-green" style={{ flex: 1 }} disabled={pinLoading || !pinValue} onClick={confirmApprove}>
                {pinLoading ? '…' : '✅ Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail slide-over */}
      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.35)' }} />
          <div style={{ width: 420, background: 'var(--surface)', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 40px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{detailRecord.ref}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Redemption Details</div>
              </div>
              <button onClick={() => setDetailRecord(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Status */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className={`bdg ${detailRecord.status === 'Approved' ? 'bdg-g' : detailRecord.status === 'Rejected' ? 'bdg-r' : 'bdg-a'}`}>{detailRecord.status}</span>
                <span className={`bdg ${detailRecord.type === 'early' ? 'bdg-a' : 'bdg-b'}`}>{detailRecord.type === 'early' ? 'Early Exit' : 'Post-Maturity'}</span>
              </div>

              {/* Customer */}
              <Section title="Customer">
                <Row label="Name" value={detailRecord.customerName} bold />
                <Row label="Customer ID" value={detailRecord.customerId} mono />
                <Row label="Agent" value={`${detailRecord.agentName} (${detailRecord.agentId})`} />
              </Section>

              {/* Financials */}
              <Section title="Payout Breakdown">
                <Row label="Gross Balance" value={fmt(detailRecord.balance)} />
                {detailRecord.penalty > 0 && <Row label="Penalty" value={`– ${fmt(detailRecord.penalty)}`} red />}
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <Row label="Net Payout" value={fmt(detailRecord.netPayout)} bold green />
                <Row label="Payout Method" value={detailRecord.payoutMethod ?? 'Cash'} />
              </Section>

              {/* Bank details */}
              {detailRecord.payoutMethod === 'Bank Transfer' && detailRecord.bankName && (
                <Section title="Bank Details">
                  <Row label="Account Name" value={detailRecord.accountName ?? '—'} />
                  <Row label="Bank" value={detailRecord.bankName} />
                  <Row label="Account No." value={detailRecord.accountNumber ?? '—'} mono />
                  {detailRecord.bankTransferStatus && <Row label="Transfer Status" value={detailRecord.bankTransferStatus} />}
                </Section>
              )}

              {/* Token */}
              {detailRecord.token && (
                <Section title="Security Token">
                  <Row label="Token" value={detailRecord.token} mono bold />
                  <Row label="Expiry" value={detailRecord.tokenExpiry ? fmtDate(detailRecord.tokenExpiry) : '—'} />
                </Section>
              )}

              {/* Reason */}
              <Section title="Reason">
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{detailRecord.reason}</div>
                {detailRecord.note && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>{detailRecord.note}</div>}
              </Section>

              {/* Timeline */}
              <Section title="Timeline">
                <Row label="Requested" value={fmtDate(detailRecord.requestedAt)} />
                {detailRecord.decidedAt && <Row label="Decided" value={fmtDate(detailRecord.decidedAt)} />}
                {detailRecord.decidedBy && <Row label="Decided by" value={detailRecord.decidedBy} />}
              </Section>

              {/* Actions for pending */}
              {['Pending', 'TokenValidated', 'AgentApproved'].includes(detailRecord.status) && (
                <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                  <button className="btn btn-green" style={{ flex: 1 }}
                    disabled={deciding === detailRecord.id + 'approve'}
                    onClick={() => { setDetailRecord(null); decide(detailRecord.id, 'approve', detailRecord) }}>
                    ✅ Approve
                  </button>
                  <button className="btn btn-danger" style={{ flex: 1 }}
                    disabled={deciding === detailRecord.id + 'reject'}
                    onClick={() => { setDetailRecord(null); decide(detailRecord.id, 'reject') }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {otpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setOtpModal(null)}>
          <div className="card" style={{ maxWidth: 460, width: '100%', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Finalise Paystack Payout</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
              Paystack requires an OTP to release the transfer for <strong>{otpModal.customerName}</strong> ({otpModal.ref}). Check the SMS on your registered admin phone and enter the 6-digit code below.
            </div>
            <input
              autoFocus
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={otpValue}
              onChange={e => { setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError('') }}
              onKeyDown={e => { if (e.key === 'Enter') submitOtp() }}
              placeholder="000000"
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${otpError ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, fontSize: 24, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', background: 'var(--surface2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
            />
            {otpError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>{otpError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} disabled={otpLoading} onClick={() => { setOtpModal(null); setOtpValue('') }}>Cancel</button>
              <button className="btn btn-green" style={{ flex: 1 }} disabled={otpLoading || otpValue.length < 4} onClick={submitOtp}>
                {otpLoading ? '…' : '✅ Complete Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
