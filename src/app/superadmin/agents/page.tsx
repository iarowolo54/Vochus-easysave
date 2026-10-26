'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Agent {
  id: string; agentId: string; name: string; phone: string
  email: string | null; emailVerified: boolean; location: string
  photoUrl?: string | null
  customerCount: number; walletBalance: number; commission: number
  status: string; lockedAt: string | null; createdAt: string; profileUnlocked: boolean
  docStatus?: string; documents?: Array<{ docType: string; fileName: string; docApprovalStatus: string }>
}

const PAGE_SIZE = 25
const REGIONS = ['Lagos Central','Lagos North','Lagos South','Lagos East','Lagos West','Abuja Central','Rivers','Kano','Oyo','Anambra','Delta','Enugu','Ogun','Kaduna','Other']
const DOCS = [
  { id: 'id',    icon: '🪪', label: 'Government-Issued ID',   sub: 'NIN slip, Passport, Driver\'s Licence or Voter\'s Card', required: true },
  { id: 'addr',  icon: '🏠', label: 'Proof of Address',        sub: 'Utility bill or bank statement (not older than 3 months)', required: true },
  { id: 'guar',  icon: '✍️', label: 'Signed Guarantor Form',   sub: 'Completed and signed Vochus Easy Save guarantor form', required: true },
  { id: 'agree', icon: '📋', label: 'Signed Agent Agreement',  sub: 'Signed Vochus Easy Save Agent Terms & Conditions', required: true },
  { id: 'bank',  icon: '💳', label: 'Bank Statement',          sub: 'Optional — for commission payout purposes', required: false },
]

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  // Invite modal
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [copied, setCopied] = useState(false)

  // Activate modal
  const [activatingAgent, setActivatingAgent] = useState<Agent | null>(null)
  const [floatLimit, setFloatLimit] = useState('')
  const [region, setRegion] = useState('')
  const [activateNotes, setActivateNotes] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState('')
  const [checkedDocs, setCheckedDocs] = useState<string[]>([])

  // Document review modal
  const [reviewingAgent, setReviewingAgent] = useState<Agent | null>(null)
  const [docApproving, setDocApproving] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [viewingAgreement, setViewingAgreement] = useState<{ agentId: string; signatureUrl: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const q = search ? `?search=${encodeURIComponent(search)}` : ''
    const res = await fetch(`/api/admin/agents${q}`)
    const d = res.ok ? await res.json() : {}
    setAgents(d.agents ?? [])
    setPage(1)
    setLoading(false)
  }, [search])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 5000) }

  async function toggleStatus(agent: Agent) {
    const newStatus = agent.status === 'Active' ? 'Suspended' : 'Active'
    const res = await fetch(`/api/admin/agents/${agent.id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) { showToast(`${agent.name} ${newStatus === 'Active' ? 'activated' : 'suspended'}`); load() }
  }

  async function toggleProfileLock(agent: Agent) {
    const res = await fetch(`/api/admin/agents/${agent.id}/profile-lock`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlock: !agent.profileUnlocked }),
    })
    if (res.ok) { showToast(`${agent.name}'s profile ${agent.profileUnlocked ? 'locked' : 'unlocked'}`); load() }
  }

  async function resendVerification(agentId: string) {
    await fetch(`/api/admin/agents/${agentId}/resend-verification`, { method: 'POST' })
    showToast('Verification email resent')
  }

  async function unblockAgent(agent: Agent) {
    const res = await fetch(`/api/admin/agents/${agent.id}/unblock`, { method: 'POST' })
    if (res.ok) { showToast(`${agent.name}'s account unblocked`); load() }
  }

  async function sendInvite() {
    setInviteError(''); setInviting(true)
    try {
      const res = await fetch('/api/superadmin/agent-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setInviteError(d.error ?? 'Failed to generate invite'); return }
      setInviteLink(d.link)
    } catch { setInviteError('Network error') }
    finally { setInviting(false) }
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function openActivate(agent: Agent) {
    setActivatingAgent(agent); setFloatLimit(''); setRegion(''); setActivateNotes(''); setActivateError(''); setCheckedDocs([])
  }

  function toggleDoc(id: string) {
    setCheckedDocs(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id])
  }

  async function activateAgent() {
    if (!floatLimit) { setActivateError('Float limit is required'); return }
    setActivating(true); setActivateError('')
    try {
      const res = await fetch(`/api/admin/agents/${activatingAgent!.id}/activate`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floatLimit, region, notes: activateNotes, requiredDocs: checkedDocs }),
      })
      const d = await res.json()
      if (!res.ok) { setActivateError(d.error ?? 'Failed'); return }
      setActivatingAgent(null)
      showToast(`${activatingAgent!.name} activated successfully`)
      load()
    } catch { setActivateError('Network error') }
    finally { setActivating(false) }
  }

  async function approveDocument(docType: string) {
    if (!reviewingAgent) return
    setDocApproving(true)
    try {
      const res = await fetch(`/api/superadmin/agents/${reviewingAgent.id}/documents/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, action: 'approve' }),
      })
      if (res.ok) {
        showToast(`Document approved`)
        setReviewingAgent(prev => prev ? {
          ...prev,
          documents: prev.documents?.map(d => d.docType === docType ? { ...d, docApprovalStatus: 'approved' } : d)
        } : null)
        load()
      } else {
        const err = await res.json().catch(() => ({}))
        showToast((err as any).error ?? 'Failed to approve document')
      }
    } catch (e) {
      showToast('Error approving document')
    }
    finally { setDocApproving(false) }
  }

  async function approveAll() {
    if (!reviewingAgent?.documents) return
    const pending = reviewingAgent.documents.filter(d => d.docApprovalStatus !== 'approved')
    setDocApproving(true)
    try {
      await Promise.all(pending.map(doc =>
        fetch(`/api/superadmin/agents/${reviewingAgent.id}/documents/approve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docType: doc.docType, action: 'approve' }),
        })
      ))
      showToast('All documents approved')
      await load()
      setReviewingAgent(null)
      setRejectionReason('')
      setSelectedDocType('')
    } catch {
      showToast('Error approving all documents')
    } finally {
      setDocApproving(false)
    }
  }

  async function rejectDocument(docType: string) {
    if (!reviewingAgent || !rejectionReason.trim()) return
    setDocApproving(true)
    try {
      const res = await fetch(`/api/superadmin/agents/${reviewingAgent.id}/documents/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, action: 'reject', reason: rejectionReason.trim() }),
      })
      if (res.ok) {
        showToast(`Document rejected and agent notified`)
        if (reviewingAgent.documents) {
          setReviewingAgent(prev => prev ? {
            ...prev,
            documents: prev.documents?.map(d => d.docType === docType ? { ...d, docApprovalStatus: 'rejected' } : d)
          } : null)
        }
        await load()
        setTimeout(() => setReviewingAgent(null), 500)
      } else {
        const err = await res.json().catch(() => ({}))
        showToast((err as any).error ?? 'Failed to reject document')
      }
    } catch (e) {
      showToast('Error rejecting document')
    }
    finally { setDocApproving(false) }
  }

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const paginated = agents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(agents.length / PAGE_SIZE)
  const pendingCount = agents.filter(a => a.status === 'PendingActivation').length

  const statusBadge = (a: Agent) => {
    if (a.docStatus === 'pending_approval') return <span className="bdg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>📋 Docs Pending</span>
    if (a.docStatus === 'rejected') return <span className="bdg bdg-r">📋 Docs Rejected</span>
    if (a.lockedAt) return <span className="bdg bdg-r">🔒 Locked</span>
    if (a.status === 'PendingActivation') return <span className="bdg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>⏳ Pending</span>
    if (a.status === 'Suspended') return <span className="bdg bdg-r">Suspended</span>
    if (a.email && !a.emailVerified) return <span className="bdg bdg-a">Unverified</span>
    return <span className="bdg bdg-g">Active</span>
  }

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>All Agents</h1>
          <p>Manage agent accounts, wallets and commissions{pendingCount > 0 && <strong style={{ color: '#92400e', marginLeft: 8 }}>· {pendingCount} pending activation</strong>}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="a-topbar-search" style={{ minWidth: 260 }}>
            <span style={{ color: 'var(--text3)' }}>🔍</span>
            <input type="text" placeholder="Search agents…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-green" onClick={() => { setShowInvite(true); setInviteEmail(''); setInviteLink(''); setInviteError(''); setCopied(false) }}>
            ✉️ Invite Agent
          </button>
        </div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Agent</th><th>Phone</th><th>Email</th><th>Location</th><th>Customers</th><th>Wallet</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && agents.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No agents found</td></tr>}
              {!loading && paginated.map(a => (
                <tr key={a.id} style={{ background: a.status === 'PendingActivation' ? '#fffbeb' : undefined }}>
                  <td><div className="td-av"><div className="av av-green" style={{ overflow: 'hidden', padding: 0 }}>{a.photoUrl ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : a.name.split(' ').map(w => w[0]).join('').slice(0,2)}</div><div><div className="td-name">{a.name}</div><div className="td-sub">{a.agentId}</div></div></div></td>
                  <td>{a.phone}</td>
                  <td>{a.email
                    ? <div><div style={{ fontSize: 13 }}>{a.email}</div>{a.emailVerified ? <span style={{ fontSize: 11, color: 'var(--g)', fontWeight: 600 }}>✓ Verified</span> : <span style={{ fontSize: 11, color: '#e67e22', fontWeight: 600 }}>⚠ Pending</span>}</div>
                    : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}</td>
                  <td>{a.location}</td>
                  <td>{a.customerCount}</td>
                  <td>{fmt(a.walletBalance)}</td>
                  <td>{statusBadge(a)}</td>
                  <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {a.docStatus === 'pending_approval' ? (
                      <button className="btn btn-xs btn-green" onClick={() => setReviewingAgent(a)}>📋 Review Docs</button>
                    ) : a.status === 'PendingActivation' ? (
                      <button className="btn btn-xs btn-green" onClick={() => openActivate(a)}>✓ Activate</button>
                    ) : (
                      <>
                        <a href={`/superadmin/agents/${a.id}`} className="btn btn-xs btn-outline" style={{ textDecoration: 'none' }}>View</a>
                        <button className="btn btn-xs btn-outline" onClick={() => toggleProfileLock(a)}>{a.profileUnlocked ? '🔒 Lock' : '🔓 Unlock'}</button>
                        {a.lockedAt && <button className="btn btn-xs btn-green" onClick={() => unblockAgent(a)}>🔓 Unblock</button>}
                        {!a.lockedAt && a.email && !a.emailVerified && <button className="btn btn-xs btn-outline" onClick={() => resendVerification(a.id)}>Resend</button>}
                        {!a.lockedAt && <button className={`btn btn-xs ${a.status === 'Active' ? 'btn-danger' : 'btn-green'}`} onClick={() => toggleStatus(a)}>{a.status === 'Active' ? 'Suspend' : 'Activate'}</button>}
                      </>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, agents.length)} of {agents.length}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn btn-xs btn-outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {page} of {totalPages}</span>
                <button className="btn btn-xs btn-outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Agent Modal */}
      {showInvite && (
        <div className="a-modal-bg" onClick={() => setShowInvite(false)}>
          <div className="a-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="a-modal-hd">
              <h2>✉️ Invite Agent</h2>
              <button className="a-modal-close" onClick={() => setShowInvite(false)}>✕</button>
            </div>

            {!inviteLink ? (
              <>
                <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
                  Enter the agent's email address. They will receive a unique link to complete their own registration — including personal details, photo, documents, and email verification.
                </p>
                {inviteError && <div className="a-alert a-alert-r" style={{ marginBottom: 14 }}>{inviteError}</div>}
                <label className="a-label">Agent Email Address *</label>
                <input className="a-input" type="email" placeholder="agent@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendInvite()} autoFocus />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 8 }}>
                  <button className="btn btn-outline" onClick={() => setShowInvite(false)}>Cancel</button>
                  <button className="btn btn-green" disabled={inviting || !inviteEmail.trim()} onClick={sendInvite}>
                    {inviting ? 'Generating…' : '🔗 Generate Invite Link'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#2e7d4f', marginBottom: 20 }}>
                  ✅ Invite link generated and email sent to <strong>{inviteEmail}</strong>
                </div>
                <label className="a-label">Invite Link (share this with the agent)</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input className="a-input" readOnly value={inviteLink} style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', marginBottom: 0 }} onClick={e => (e.target as HTMLInputElement).select()} />
                  <button className="btn btn-green" style={{ flexShrink: 0 }} onClick={copyLink}>
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#92400e', marginBottom: 16 }}>
                  ⏳ The agent will appear in this list as <strong>"Pending Activation"</strong> after completing their registration. You can then activate their account and set their float limit.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-outline" onClick={() => { setInviteLink(''); setInviteEmail('') }}>Send Another</button>
                  <button className="btn btn-green" onClick={() => setShowInvite(false)}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Activate Agent Modal */}
      {activatingAgent && (
        <div className="a-modal-bg" onClick={() => setActivatingAgent(null)}>
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="a-modal-hd">
              <h2>✓ Activate Agent</h2>
              <button className="a-modal-close" onClick={() => setActivatingAgent(null)}>✕</button>
            </div>

            <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: '12px 14px', fontSize: 13, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{activatingAgent.name}</div>
              <div style={{ color: '#555', fontSize: 12 }}>{activatingAgent.agentId} · {activatingAgent.phone} · {activatingAgent.email}</div>
            </div>

            {activateError && <div className="a-alert a-alert-r" style={{ marginBottom: 14 }}>{activateError}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="a-label">Float Limit (₦) *</label>
                <input className="a-input" type="tel" inputMode="decimal" placeholder="e.g. 200000" value={floatLimit} onKeyDown={blockMinus} onChange={e => setFloatLimit(nonNegativeString(e.target.value))} autoFocus />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="a-label">Commission Rate</label>
                <div className="a-input" style={{ background: 'var(--surface2)', color: 'var(--text3)', cursor: 'not-allowed', marginBottom: 0 }}>
                  0.4% of savings volume (platform default)
                </div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="a-label">Assigned Region</label>
                <select className="a-input" value={region} onChange={e => setRegion(e.target.value)}>
                  <option value="">Select Region (optional)</option>
                  {REGIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="a-label">Internal Notes</label>
                <textarea className="a-input" rows={2} placeholder="Any notes about this agent…" value={activateNotes} onChange={e => setActivateNotes(e.target.value)} style={{ resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="a-label" style={{ marginBottom: 8 }}>Documents Received</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {DOCS.filter(doc => doc.required).map(doc => {
                  const checked = checkedDocs.includes(doc.id)
                  return (
                    <div key={doc.id} onClick={() => toggleDoc(doc.id)} style={{ border: `1.5px solid ${checked ? '#1a5c35' : 'var(--border)'}`, borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: checked ? '#f0faf4' : 'var(--surface)', transition: 'all .15s' }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? '#1a5c35' : '#d1d5db'}`, background: checked ? '#1a5c35' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {checked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{doc.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text1)' }}>{doc.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{doc.sub}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#92400e', marginBottom: 16 }}>
              The agent will be notified by email and can immediately log in to the agent portal.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-outline" onClick={() => setActivatingAgent(null)}>Cancel</button>
              <button className="btn btn-green" disabled={activating} onClick={activateAgent}>
                {activating ? 'Activating…' : '✓ Activate Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Review Modal */}
      {reviewingAgent && (
        <div className="a-modal-bg" onClick={() => setReviewingAgent(null)}>
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="a-modal-hd">
              <h2>📋 Review Documents</h2>
              <button className="a-modal-close" onClick={() => { setReviewingAgent(null); setRejectionReason(''); setSelectedDocType('') }}>✕</button>
            </div>

            <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: '12px 14px', fontSize: 13, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{reviewingAgent.name}</div>
              <div style={{ color: '#555', fontSize: 12 }}>{reviewingAgent.agentId} · {reviewingAgent.phone}</div>
            </div>

            <label className="a-label" style={{ marginBottom: 12 }}>Submitted Documents</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {reviewingAgent.documents && reviewingAgent.documents.length > 0 ? (
                reviewingAgent.documents.map(doc => {
                  const status = doc.docApprovalStatus
                  const isApproved = status === 'approved'
                  const isRejected = status === 'rejected'
                  return (
                  <div key={doc.docType} style={{
                    padding: '12px 14px',
                    border: `1px solid ${isApproved ? '#b6e8c8' : isRejected ? '#fca5a5' : '#d1d5db'}`,
                    borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: isApproved ? '#f0faf4' : isRejected ? '#fff5f5' : '#fff',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{DOCS.find(d => d.id === doc.docType)?.icon || '📄'}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{DOCS.find(d => d.id === doc.docType)?.label || doc.docType}</span>
                          {isApproved && <span style={{ fontSize: 10, fontWeight: 700, color: '#2e7d4f', background: '#d1fae5', padding: '1px 6px', borderRadius: 4 }}>✓ Approved</span>}
                          {isRejected && <span style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>✕ Rejected</span>}
                          {!isApproved && !isRejected && <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>⏳ Pending</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {doc.docType === 'agree' ? (
                        <button
                          type="button"
                          className="btn btn-xs btn-outline"
                          onClick={() => setViewingAgreement({
                            agentId: reviewingAgent.id,
                            signatureUrl: `/api/agent/documents/${doc.docType}?agentId=${reviewingAgent.id}`,
                          })}
                        >
                          View
                        </button>
                      ) : (
                        <a href={`/api/agent/documents/${doc.docType}?agentId=${reviewingAgent.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline">
                          View
                        </a>
                      )}
                      {!isApproved && (
                        <button
                          className="btn btn-xs btn-green"
                          disabled={docApproving}
                          onClick={() => approveDocument(doc.docType)}
                        >
                          ✓
                        </button>
                      )}
                      {!isRejected && (
                        <button
                          className="btn btn-xs btn-danger"
                          disabled={docApproving}
                          onClick={() => setSelectedDocType(doc.docType)}
                          style={{ opacity: selectedDocType === doc.docType ? 1 : 0.6 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  )
                })
              ) : (
                <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: 13 }}>No documents submitted</div>
              )}
            </div>

            {selectedDocType && (
              <div style={{ marginBottom: 16 }}>
                <label className="a-label" style={{ marginBottom: 8 }}>Reason for Rejection</label>
                <textarea
                  className="a-input"
                  placeholder="Provide feedback for the agent…"
                  rows={3}
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  style={{ resize: 'vertical' }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setSelectedDocType('')
                      setRejectionReason('')
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={docApproving || !rejectionReason.trim()}
                    onClick={() => rejectDocument(selectedDocType)}
                  >
                    ✕ Reject & Send Feedback
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-outline" onClick={() => { setReviewingAgent(null); setRejectionReason(''); setSelectedDocType('') }} disabled={docApproving}>Cancel</button>
              {reviewingAgent.documents?.some(d => d.docApprovalStatus !== 'approved') && (
                <button className="btn btn-green" onClick={approveAll} disabled={docApproving}>
                  ✓ Approve All
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingAgreement && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setViewingAgreement(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1a1a2e' }}>Signed Agent Agreement</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Vochus Easy Save Agent Terms & Conditions</div>
              </div>
              <button onClick={() => setViewingAgreement(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999', width: 32, height: 32 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '20px 24px', fontSize: 13, lineHeight: 1.7, color: '#333' }}>
              <p><strong>1. AGREEMENT TO TERMS</strong></p>
              <p>By becoming an agent for Vochus Easy Save, you agree to comply with all terms and conditions outlined in this agreement. This includes all operational guidelines, compliance requirements, and financial obligations.</p>
              <p><strong>2. AGENT RESPONSIBILITIES</strong></p>
              <p>As an agent, you are responsible for: enrolling customers, recording savings transactions, maintaining accurate records, safeguarding customer funds, and reporting all transactions promptly. You must conduct all activities in accordance with applicable laws and platform policies.</p>
              <p><strong>3. COMMISSION STRUCTURE</strong></p>
              <p>Agents earn commission based on savings volume (0.4% of savings amount) and customer enrolments (₦2 per enrolment). Commission is calculated monthly and deposited into your agent wallet.</p>
              <p><strong>4. FLOAT LIMIT</strong></p>
              <p>You are allocated a float limit as specified during activation. You are responsible for safeguarding all funds up to this limit and must account for every transaction.</p>
              <p><strong>5. COMPLIANCE & CONDUCT</strong></p>
              <p>You must comply with all KYC/AML requirements, maintain confidentiality of customer information, and conduct business with integrity. Any fraudulent activity will result in immediate account suspension and legal action.</p>
              <p><strong>6. TERMINATION</strong></p>
              <p>Vochus reserves the right to terminate this agreement at any time if you violate terms, engage in misconduct, or fail to meet performance standards.</p>
              <p><strong>7. LIABILITY</strong></p>
              <p>You acknowledge that you are an independent agent and not an employee. You are solely responsible for any losses or disputes arising from your activities.</p>

              <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>Signed by {reviewingAgent?.name}</div>
                <div style={{ border: '1.5px solid #d1d5db', borderRadius: 10, background: '#fafafa', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
                  <img src={viewingAgreement.signatureUrl} alt="Agent signature" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} />
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 8, textAlign: 'center' }}>{reviewingAgent?.agentId} · Signature captured on registration</div>
              </div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setViewingAgreement(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
