'use client'

import { useState, useEffect, useCallback } from 'react'

interface WithdrawalRecord {
  id: string
  ref: string
  agentId: string
  agentName: string
  agentDisplayId: string
  agentPhone: string
  agentCommissionBalance: number
  amount: number
  note: string | null
  status: string
  bankCode: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  bankTransferStatus: string | null
  paystackTransferCode: string | null
  adminNote: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
}

interface PageData {
  pending: number
  approved: number
  rejected: number
  totalPaidOut: number
  records: WithdrawalRecord[]
}

const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AgentWithdrawalsPage() {
  const [data, setData] = useState<PageData>({ pending: 0, approved: 0, rejected: 0, totalPaidOut: 0, records: [] })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [toast, setToast] = useState('')
  const [detailRecord, setDetailRecord] = useState<WithdrawalRecord | null>(null)

  const [pinModal, setPinModal] = useState<WithdrawalRecord | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)

  const [rejectModal, setRejectModal] = useState<WithdrawalRecord | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectLoading, setRejectLoading] = useState(false)
  const [rejectError, setRejectError] = useState('')

  const [otpModal, setOtpModal] = useState<{ id: string; ref: string; agentName: string } | null>(null)
  const [otpValue, setOtpValue] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/agent-withdrawal')
    if (res.ok) { const d = await res.json(); setData(d) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const PENDING_STATUSES = ['Pending', 'AwaitingOTP', 'Processing']
  const pending = data.records.filter(r => PENDING_STATUSES.includes(r.status))
  const history = data.records.filter(r => !PENDING_STATUSES.includes(r.status))

  async function confirmApprove() {
    if (!pinModal) return
    if (!pinValue.trim()) { setPinError('Enter your approval PIN'); return }
    setPinLoading(true); setPinError('')
    const res = await fetch(`/api/admin/agent-withdrawal/${pinModal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', pin: pinValue }),
    })
    setPinLoading(false)
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      const pend = pinModal
      setPinModal(null); setPinValue('')
      if (d.status === 'AwaitingOTP') {
        setOtpModal({ id: pend.id, ref: pend.ref, agentName: pend.agentName })
        showToast('📩 Paystack sent an OTP — enter it to finish the payout')
        load()
        return
      }
      showToast(d.bankTransferStatus === 'success'
        ? '✅ Approved — Paystack transfer sent'
        : '✅ Approved — Bank transfer initiated')
      load()
    } else {
      setPinError(d.error ?? 'Approval failed')
    }
  }

  async function confirmReject() {
    if (!rejectModal) return
    setRejectLoading(true); setRejectError('')
    const res = await fetch(`/api/admin/agent-withdrawal/${rejectModal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', adminNote: rejectNote }),
    })
    setRejectLoading(false)
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      setRejectModal(null); setRejectNote('')
      showToast('❌ Rejected — commission refunded to agent')
      load()
    } else {
      setRejectError(d.error ?? 'Rejection failed')
    }
  }

  async function verify(id: string) {
    const res = await fetch(`/api/admin/agent-withdrawal/${id}/verify`, { method: 'POST' })
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      showToast(`Paystack: ${d.bankTransferStatus} → ${d.status}`)
      load()
    } else {
      showToast(d.error ?? 'Verify failed')
    }
  }

  async function submitOtp() {
    if (!otpModal) return
    if (!otpValue.trim()) { setOtpError('Enter the OTP Paystack sent you'); return }
    setOtpLoading(true); setOtpError('')
    const res = await fetch(`/api/admin/agent-withdrawal/${otpModal.id}/finalize-otp`, {
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
      setOtpError(d.error ?? 'OTP finalisation failed')
    }
  }

  const Section = ({ title }: { title: string }) => (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--text3)', margin: '20px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{title}</div>
  )
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Agent Withdrawals</h1>
          <p>Approve and pay out agent commission requests</p>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 22 }}>
        <div className="stat"><span className="stat-ic">⏳</span><div className="stat-lbl">Pending Approval</div><div className="stat-val amber">{data.pending}</div><div className="stat-sub">Awaiting super admin action</div></div>
        <div className="stat"><span className="stat-ic">✅</span><div className="stat-lbl">Approved</div><div className="stat-val green">{data.approved}</div><div className="stat-sub">All time</div></div>
        <div className="stat"><span className="stat-ic">❌</span><div className="stat-lbl">Rejected</div><div className="stat-val red">{data.rejected}</div></div>
        <div className="stat"><span className="stat-ic">💸</span><div className="stat-lbl">Total Paid Out</div><div className="stat-val blue">{fmt(data.totalPaidOut)}</div></div>
      </div>

      <div className="tab-bar">
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => setTab('pending')}>⏳ Pending ({pending.length})</button>
        <button className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>📋 History ({history.length})</button>
      </div>

      {tab === 'pending' && (
        <div className="card">
          <div className="card-hd">
            <h3>Pending Withdrawal Requests</h3>
            <span className="bdg bdg-a">{pending.length} awaiting</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th><th>Agent</th><th>Amount</th><th>Payout Bank</th><th>Note</th><th>Requested</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
                {!loading && pending.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No pending requests</td></tr>}
                {!loading && pending.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setDetailRecord(r) }}>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 12, color: 'var(--blue)' }}>{r.ref}</td>
                    <td>
                      <div className="td-name">{r.agentName}</div>
                      <div className="td-sub">{r.agentDisplayId} · {r.agentPhone}</div>
                    </td>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, color: 'var(--green)' }}>{fmt(r.amount)}</td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{r.accountName}</div>
                      <div style={{ color: 'var(--text3)' }}>{r.bankName} · ****{r.accountNumber?.slice(-4)}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note ?? '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(r.requestedAt)}</td>
                    <td>
                      {r.status === 'AwaitingOTP' ? (
                        <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span className="bdg bdg-a" style={{ fontSize: 10 }}>📩 Awaiting OTP</span>
                          <button className="btn btn-xs btn-blue" onClick={() => setOtpModal({ id: r.id, ref: r.ref, agentName: r.agentName })}>
                            Enter OTP →
                          </button>
                        </div>
                      ) : r.status === 'Processing' ? (
                        <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span className="bdg bdg-b" style={{ fontSize: 10 }}>⏳ Paystack Processing</span>
                          <button className="btn btn-xs btn-blue" onClick={() => verify(r.id)}>
                            🔄 Verify with Paystack
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button className="btn btn-xs btn-green" onClick={() => { setPinModal(r); setPinValue(''); setPinError('') }}>
                            ✅ Approve
                          </button>
                          <button className="btn btn-xs btn-danger" onClick={() => { setRejectModal(r); setRejectNote(''); setRejectError('') }}>
                            Reject
                          </button>
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

      {tab === 'history' && (
        <div className="card">
          <div className="card-hd">
            <h3>Decided Requests</h3>
            <span className="bdg bdg-b">{history.length} records</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Ref</th><th>Agent</th><th>Amount</th><th>Payout Bank</th><th>Decision</th><th>Paystack</th><th>Decided By</th><th>Date</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {history.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No records</td></tr>}
                {history.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setDetailRecord(r) }}>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 12, color: 'var(--blue)' }}>{r.ref}</td>
                    <td><div className="td-name">{r.agentName}</div><div className="td-sub">{r.agentDisplayId}</div></td>
                    <td style={{ fontWeight: 700 }}>{fmt(r.amount)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.bankName} · ****{r.accountNumber?.slice(-4)}</td>
                    <td><span className={`bdg ${r.status === 'Approved' ? 'bdg-g' : 'bdg-r'}`}>{r.status}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.bankTransferStatus ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.decidedBy ?? '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.decidedAt ? fmtDate(r.decidedAt) : '—'}</td>
                    <td>
                      {r.paystackTransferCode && (
                        <button className="btn btn-xs btn-outline" onClick={() => verify(r.id)}>🔄 Verify</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>

      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.45)' }} />
          <div style={{ width: 440, background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)', fontFamily: 'monospace' }}>{detailRecord.ref}</div>
                <div style={{ marginTop: 6 }}>
                  <span className={`bdg ${detailRecord.status === 'Approved' ? 'bdg-g' : detailRecord.status === 'Rejected' ? 'bdg-r' : 'bdg-a'}`}>{detailRecord.status}</span>
                </div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <Section title="Agent" />
            <Row label="Name" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentDisplayId} />
            <Row label="Phone" value={detailRecord.agentPhone} />
            <Row label="Commission Balance" value={fmt(detailRecord.agentCommissionBalance)} />

            <Section title="Withdrawal" />
            <Row label="Amount" value={<span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{fmt(detailRecord.amount)}</span>} />
            <Row label="Note" value={detailRecord.note} />
            <Row label="Requested" value={fmtDate(detailRecord.requestedAt)} />

            <Section title="Bank Details" />
            <Row label="Account Name" value={detailRecord.accountName} />
            <Row label="Bank" value={detailRecord.bankName} />
            <Row label="Account No." value={detailRecord.accountNumber} />

            {(detailRecord.decidedBy || detailRecord.decidedAt || detailRecord.adminNote) && (
              <>
                <Section title="Decision" />
                <Row label="Decided By" value={detailRecord.decidedBy} />
                <Row label="Decided At" value={detailRecord.decidedAt ? fmtDate(detailRecord.decidedAt) : null} />
                {detailRecord.adminNote && <Row label="Admin Note" value={detailRecord.adminNote} />}
                {detailRecord.bankTransferStatus && <Row label="Paystack Status" value={detailRecord.bankTransferStatus} />}
              </>
            )}

            {PENDING_STATUSES.includes(detailRecord.status) && (
              <div style={{ marginTop: 24 }}>
                {detailRecord.status === 'AwaitingOTP' ? (
                  <button className="btn btn-blue" style={{ width: '100%' }} onClick={() => { setDetailRecord(null); setOtpModal({ id: detailRecord.id, ref: detailRecord.ref, agentName: detailRecord.agentName }) }}>
                    📩 Enter OTP
                  </button>
                ) : detailRecord.status === 'Processing' ? (
                  <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => { setDetailRecord(null); verify(detailRecord.id) }}>
                    🔄 Verify with Paystack
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-green" style={{ flex: 1 }} onClick={() => { setDetailRecord(null); setPinModal(detailRecord); setPinValue(''); setPinError('') }}>✅ Approve</button>
                    <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { setDetailRecord(null); setRejectModal(detailRecord); setRejectNote(''); setRejectError('') }}>Reject</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {pinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 32, width: 380, boxShadow: '0 24px 60px rgba(0,0,0,.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Approval PIN Required</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
                Approving <strong style={{ color: 'var(--green)' }}>{fmt(pinModal.amount)}</strong> payout to <strong>{pinModal.agentName}</strong>
              </div>
              <div style={{ marginTop: 12, background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 12, textAlign: 'left' }}>
                <div style={{ color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.6px', fontSize: 10, fontWeight: 700 }}>💳 Paystack Transfer</div>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{pinModal.accountName}</div>
                <div style={{ color: 'var(--text2)' }}>{pinModal.bankName} · ****{pinModal.accountNumber?.slice(-4)}</div>
              </div>
            </div>
            <input
              type="password" inputMode="numeric" maxLength={6}
              value={pinValue}
              onChange={e => { setPinValue(e.target.value); setPinError('') }}
              onKeyDown={e => e.key === 'Enter' && confirmApprove()}
              autoFocus placeholder="••••"
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${pinError ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, fontSize: 24, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', background: 'var(--surface2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
            />
            {pinError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>{pinError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setPinModal(null); setPinValue(''); setPinError('') }}>Cancel</button>
              <button className="btn btn-green" style={{ flex: 1 }} disabled={pinLoading || !pinValue} onClick={confirmApprove}>
                {pinLoading ? '…' : '✅ Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: 400 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Reject Withdrawal</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
              Reject {fmt(rejectModal.amount)} withdrawal for <strong>{rejectModal.agentName}</strong>? The amount will be refunded to their commission balance.
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Reason (visible to agent)</label>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={3}
              placeholder="e.g. Bank details unverified — please update account"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box', marginBottom: 12 }}
            />
            {rejectError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{rejectError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRejectModal(null)}>Cancel</button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={rejectLoading} onClick={confirmReject}>
                {rejectLoading ? '…' : 'Reject & Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {otpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setOtpModal(null)}>
          <div className="card" style={{ maxWidth: 460, width: '100%', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Finalise Paystack Payout</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
              Paystack requires an OTP to release the transfer for <strong>{otpModal.agentName}</strong> ({otpModal.ref}). Enter the 6-digit code from SMS.
            </div>
            <input
              autoFocus type="tel" inputMode="numeric" maxLength={6}
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
