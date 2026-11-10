'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, RowMenu, SearchField, Segmented,
  TableSkeleton, naira, useDebounced, useToast,
} from '../_components/admin-ui'

interface Agent {
  id: string; agentId: string; name: string; phone: string
  email: string | null; emailVerified: boolean; location: string
  photoUrl?: string | null
  customerCount: number; walletBalance: number; commission: number
  status: string; lockedAt: string | null; createdAt: string; profileUnlocked: boolean
  docStatus?: string; documents?: Array<{ docType: string; fileName: string; docApprovalStatus: string }>
}

type Filter = 'all' | 'action' | 'active' | 'suspended'

const PAGE_SIZE = 25
const REGIONS = ['Lagos Central', 'Lagos North', 'Lagos South', 'Lagos East', 'Lagos West', 'Abuja Central', 'Rivers', 'Kano', 'Oyo', 'Anambra', 'Delta', 'Enugu', 'Ogun', 'Kaduna', 'Other']
const DOCS = [
  { id: 'id', label: 'Government-issued ID', sub: 'NIN slip, passport, driver’s licence or voter’s card', required: true },
  { id: 'addr', label: 'Proof of address', sub: 'Utility bill or bank statement from the last 3 months', required: true },
  { id: 'guar', label: 'Signed guarantor form', sub: 'Completed and signed Vochus Easy Save guarantor form', required: true },
  { id: 'agree', label: 'Signed agent agreement', sub: 'Signed Vochus Easy Save agent terms and conditions', required: true },
  { id: 'bank', label: 'Bank statement', sub: 'Optional, for commission payouts', required: false },
]
const docLabel = (t: string) => DOCS.find(d => d.id === t)?.label ?? t

const needsAction = (a: Agent) => a.status === 'PendingActivation' || a.docStatus === 'pending_approval' || !!a.lockedAt
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function StatusBadge({ a }: { a: Agent }) {
  if (a.docStatus === 'pending_approval') return <span className="bdg bdg-a">Documents to review</span>
  if (a.docStatus === 'rejected') return <span className="bdg bdg-r">Documents rejected</span>
  if (a.lockedAt) return <span className="bdg bdg-r">Locked out</span>
  if (a.status === 'PendingActivation') return <span className="bdg bdg-a">Waiting to activate</span>
  if (a.status === 'Suspended') return <span className="bdg bdg-r">Suspended</span>
  if (a.email && !a.emailVerified) return <span className="bdg bdg-grey">Email not verified</span>
  return <span className="bdg bdg-g">Active</span>
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [toastNode, toast] = useToast()

  // Invite
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [copied, setCopied] = useState(false)

  // Activate
  const [activatingAgent, setActivatingAgent] = useState<Agent | null>(null)
  const [floatLimit, setFloatLimit] = useState('')
  const [floatError, setFloatError] = useState('')
  const [region, setRegion] = useState('')
  const [activateNotes, setActivateNotes] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState('')
  const [checkedDocs, setCheckedDocs] = useState<string[]>([])

  // Document review
  const [reviewingAgent, setReviewingAgent] = useState<Agent | null>(null)
  const [docApproving, setDocApproving] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [viewingAgreement, setViewingAgreement] = useState<{ name: string; agentId: string; signatureUrl: string } | null>(null)

  // Suspend / reactivate confirmation
  const [statusTarget, setStatusTarget] = useState<Agent | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/agents${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setAgents(d.agents ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, filter])

  async function changeStatus() {
    if (!statusTarget) return
    const newStatus = statusTarget.status === 'Active' ? 'Suspended' : 'Active'
    setStatusBusy(true); setStatusError('')
    try {
      const res = await fetch(`/api/admin/agents/${statusTarget.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) { setStatusError(await errorOf(res, 'That didn’t go through. Try again.')); return }
      toast(`${statusTarget.name} ${newStatus === 'Active' ? 'reactivated' : 'suspended'}`, 'success')
      setStatusTarget(null)
      load()
    } catch {
      setStatusError('No connection. Check your internet and try again.')
    } finally {
      setStatusBusy(false)
    }
  }

  async function simpleAction(url: string, init: RequestInit, done: string) {
    try {
      const res = await fetch(url, init)
      if (!res.ok) { toast(await errorOf(res, 'That didn’t go through. Try again.'), 'error'); return }
      toast(done, 'success')
      load()
    } catch {
      toast('No connection. Check your internet and try again.', 'error')
    }
  }

  const toggleProfileLock = (a: Agent) => simpleAction(`/api/admin/agents/${a.id}/profile-lock`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unlock: !a.profileUnlocked }),
  }, a.profileUnlocked ? `${a.name} can no longer edit their profile` : `${a.name} can edit their profile once`)
  const resendVerification = (a: Agent) => simpleAction(`/api/admin/agents/${a.id}/resend-verification`, { method: 'POST' }, `Verification email sent to ${a.email}`)
  const unblockAgent = (a: Agent) => simpleAction(`/api/admin/agents/${a.id}/unblock`, { method: 'POST' }, `${a.name} can sign in again`)

  const [downloading, setDownloading] = useState(false)
  async function downloadReport() {
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/reports/agents')
      if (!res.ok) { toast(await errorOf(res, 'The report wasn’t downloaded. Try again.'), 'error'); return }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'agent-report.csv'
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast('No connection. Check your internet and try again.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  function openInvite() {
    setShowInvite(true); setInviteEmail(''); setInviteLink(''); setInviteError(''); setCopied(false)
  }

  async function sendInvite() {
    const email = inviteEmail.trim()
    if (!EMAIL_RE.test(email)) { setInviteError('Enter a valid email, like name@example.com.'); return }
    setInviteError(''); setInviting(true)
    try {
      const res = await fetch('/api/superadmin/agent-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setInviteError(d.error ?? 'The invite wasn’t created. Try again.'); return }
      setInviteLink(d.link)
    } catch {
      setInviteError('No connection. Check your internet and try again.')
    } finally {
      setInviting(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('Couldn’t copy. Select the link and copy it yourself.', 'error')
    }
  }

  function openActivate(agent: Agent) {
    setActivatingAgent(agent); setFloatLimit(''); setFloatError(''); setRegion(''); setActivateNotes(''); setActivateError(''); setCheckedDocs([])
  }

  async function activateAgent() {
    if (!activatingAgent) return
    if (!floatLimit || Number(floatLimit) <= 0) { setFloatError('Enter the float limit for this agent.'); return }
    setActivating(true); setActivateError('')
    try {
      const res = await fetch(`/api/admin/agents/${activatingAgent.id}/activate`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floatLimit, region, notes: activateNotes, requiredDocs: checkedDocs }),
      })
      if (!res.ok) { setActivateError(await errorOf(res, 'The account wasn’t activated. Try again.')); return }
      toast(`${activatingAgent.name} is now active`, 'success')
      setActivatingAgent(null)
      load()
    } catch {
      setActivateError('No connection. Check your internet and try again.')
    } finally {
      setActivating(false)
    }
  }

  function closeReview() {
    if (docApproving) return
    setReviewingAgent(null); setRejectionReason(''); setSelectedDocType(''); setReviewError('')
  }

  function markDoc(docType: string, status: string) {
    setReviewingAgent(prev => prev ? { ...prev, documents: prev.documents?.map(d => d.docType === docType ? { ...d, docApprovalStatus: status } : d) } : null)
  }

  async function postDocDecision(agentId: string, body: Record<string, string>) {
    return fetch(`/api/superadmin/agents/${agentId}/documents/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  async function approveDocument(docType: string) {
    if (!reviewingAgent) return
    setDocApproving(true); setReviewError('')
    try {
      const res = await postDocDecision(reviewingAgent.id, { docType, action: 'approve' })
      if (!res.ok) { setReviewError(await errorOf(res, 'That document wasn’t approved. Try again.')); return }
      markDoc(docType, 'approved')
      toast(`${docLabel(docType)} approved`, 'success')
      load()
    } catch {
      setReviewError('No connection. Check your internet and try again.')
    } finally {
      setDocApproving(false)
    }
  }

  async function approveAll() {
    if (!reviewingAgent?.documents) return
    const pending = reviewingAgent.documents.filter(d => d.docApprovalStatus !== 'approved')
    setDocApproving(true); setReviewError('')
    try {
      const results = await Promise.all(pending.map(async doc => {
        const res = await postDocDecision(reviewingAgent.id, { docType: doc.docType, action: 'approve' }).catch(() => null)
        if (res?.ok) markDoc(doc.docType, 'approved')
        return res?.ok ?? false
      }))
      const failedCount = results.filter(ok => !ok).length
      await load()
      if (failedCount) { setReviewError(`${failedCount} document${failedCount === 1 ? '' : 's'} weren’t approved. Try again.`); return }
      toast('All documents approved', 'success')
      setReviewingAgent(null); setRejectionReason(''); setSelectedDocType('')
    } finally {
      setDocApproving(false)
    }
  }

  async function rejectDocument(docType: string) {
    if (!reviewingAgent || !rejectionReason.trim()) return
    setDocApproving(true); setReviewError('')
    try {
      const res = await postDocDecision(reviewingAgent.id, { docType, action: 'reject', reason: rejectionReason.trim() })
      if (!res.ok) { setReviewError(await errorOf(res, 'That document wasn’t rejected. Try again.')); return }
      markDoc(docType, 'rejected')
      toast(`${docLabel(docType)} rejected. The agent has been told why.`, 'success')
      setSelectedDocType(''); setRejectionReason('')
      load()
    } catch {
      setReviewError('No connection. Check your internet and try again.')
    } finally {
      setDocApproving(false)
    }
  }

  const counts = {
    all: agents.length,
    action: agents.filter(needsAction).length,
    active: agents.filter(a => a.status === 'Active' && !needsAction(a)).length,
    suspended: agents.filter(a => a.status === 'Suspended').length,
  }
  const shown = agents.filter(a =>
    filter === 'all' ? true : filter === 'action' ? needsAction(a) : filter === 'active' ? a.status === 'Active' && !needsAction(a) : a.status === 'Suspended')
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function primaryAction(a: Agent) {
    if (a.docStatus === 'pending_approval') return <button type="button" className="btn btn-sm btn-green" onClick={() => { setReviewError(''); setReviewingAgent(a) }}>Review documents</button>
    if (a.status === 'PendingActivation') return <button type="button" className="btn btn-sm btn-green" onClick={() => openActivate(a)}>Activate</button>
    if (a.lockedAt) return <button type="button" className="btn btn-sm btn-soft" onClick={() => unblockAgent(a)}>Unlock sign-in</button>
    return null
  }

  return (
    <>
      <PageHeader
        title="Agents"
        sub={loading && !agents.length ? 'Loading…' : failed && !agents.length ? 'Everyone who collects savings for Vochus.' : `${counts.all.toLocaleString('en-NG')} agent${counts.all === 1 ? '' : 's'}${counts.action ? ` · ${counts.action} need${counts.action === 1 ? 's' : ''} your attention` : ''}`}
        actions={<>
          <button type="button" className="btn btn-outline" onClick={downloadReport} disabled={downloading} aria-busy={downloading}>
            <Icons.download size={18} aria-hidden="true" /> {downloading ? 'Preparing…' : 'Download agents report'}
          </button>
          <button type="button" className="btn btn-green" onClick={openInvite}><Icons.add size={18} aria-hidden="true" /> Invite an agent</button>
        </>}
      />

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, agent ID or location" label="Search agents" />
        <Segmented<Filter> label="Filter agents" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: failed && !agents.length ? undefined : counts.all },
          { value: 'action', label: 'Needs action', count: failed && !agents.length ? undefined : counts.action },
          { value: 'active', label: 'Active', count: failed && !agents.length ? undefined : counts.active },
          { value: 'suspended', label: 'Suspended', count: failed && !agents.length ? undefined : counts.suspended },
        ]} />
      </div>

      <section className="card" aria-label="Agents">
        {loading && !agents.length ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="agents" onRetry={load} />
          : shown.length === 0 ? (
            q ? <Empty icon="search" title={`No agents match “${q}”`} text="Check the spelling, or search by agent ID or location." />
              : filter !== 'all' ? <Empty icon="check" title="Nothing here" text="No agents are in this group right now." />
              : <Empty icon="customers" title="No agents yet" text="Invite your first agent. They’ll show here once they’ve registered."
                  action={<button type="button" className="btn btn-green" onClick={openInvite}>Invite an agent</button>} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th><th>Contact</th><th>Location</th>
                      <th className="num">Customers</th><th className="num">Wallet</th>
                      <th>Status</th><th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(a => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/superadmin/agents/${a.id}`} className="td-av ag-link">
                            <Avatar name={a.name} photoUrl={a.photoUrl} tone={needsAction(a) ? 'amber' : 'green'} />
                            <span>
                              <span className="td-name ui-block">{a.name}</span>
                              <span className="td-sub ui-block">{a.agentId}</span>
                            </span>
                          </Link>
                        </td>
                        <td data-label="Contact">
                          <div>
                            <div>{a.phone}</div>
                          {a.email && <div className="td-sub ag-email">{a.email}{!a.emailVerified && <span className="ag-unverified"> · not verified</span>}</div>}
                          </div>
                        </td>
                        <td data-label="Location">{a.location || '—'}</td>
                        <td className="num" data-label="Customers">{a.customerCount.toLocaleString('en-NG')}</td>
                        <td className="num" data-label="Wallet">{naira(a.walletBalance)}</td>
                        <td data-label="Status"><StatusBadge a={a} /></td>
                        <td>
                          <div className="a-row-actions">
                            {primaryAction(a)}
                            <RowMenu label={`More actions for ${a.name}`} items={[
                              { label: 'View profile', href: `/superadmin/agents/${a.id}` },
                              a.status !== 'PendingActivation' && { label: a.profileUnlocked ? 'Lock profile editing' : 'Allow one profile edit', onSelect: () => toggleProfileLock(a) },
                              !!a.email && !a.emailVerified && { label: 'Resend verification email', onSelect: () => resendVerification(a) },
                              a.status === 'Active' && { label: 'Suspend agent', danger: true, onSelect: () => { setStatusError(''); setStatusTarget(a) } },
                              a.status === 'Suspended' && { label: 'Reactivate agent', onSelect: () => { setStatusError(''); setStatusTarget(a) } },
                            ]} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
            </>
          )}
      </section>

      {showInvite && (
        <Modal icon="send" title="Invite an agent" onClose={() => setShowInvite(false)} busy={inviting}
          sub={inviteLink ? undefined : 'They’ll get a link to register themselves: details, photo, documents and email check.'}
          footer={inviteLink ? <>
            <button type="button" className="btn btn-outline" onClick={() => { setInviteLink(''); setInviteEmail('') }}>Invite someone else</button>
            <button type="button" className="btn btn-green" onClick={() => setShowInvite(false)}>Done</button>
          </> : <>
            <button type="button" className="btn btn-outline" onClick={() => setShowInvite(false)} disabled={inviting}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={inviting} onClick={sendInvite}>{inviting ? 'Sending…' : 'Send invite'}</button>
          </>}>
          {!inviteLink ? (
            <form onSubmit={e => { e.preventDefault(); sendInvite() }} noValidate>
              <Field id="inv-email" label="Agent’s email address" error={inviteError}>
                <input id="inv-email" className="a-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
                  placeholder="name@example.com" value={inviteEmail} aria-invalid={!!inviteError}
                  onChange={e => { setInviteEmail(e.target.value); setInviteError('') }} />
              </Field>
            </form>
          ) : (
            <>
              <div className="ag-sent">
                <span className="ag-sent-ic" aria-hidden="true"><Icons.check size={20} /></span>
                <div>
                  <strong>Invite sent to {inviteEmail.trim()}</strong>
                  <p>You can also share this link with them directly.</p>
                </div>
              </div>
              <Field id="inv-link" label="Invite link">
                <div className="ag-copy">
                  <input id="inv-link" className="a-input ag-mono" readOnly value={inviteLink} onFocus={e => e.target.select()} />
                  <button type="button" className="btn btn-outline" onClick={copyLink}>{copied ? <><Icons.check size={16} aria-hidden="true" /> Copied</> : 'Copy'}</button>
                </div>
              </Field>
              <p className="a-hint">They’ll show under <strong>Needs action</strong> once they finish registering. Then you can activate them and set their float limit.</p>
            </>
          )}
        </Modal>
      )}

      {activatingAgent && (
        <Modal error={activateError || undefined} icon="check" tone="money" title={`Activate ${activatingAgent.name}`} onClose={() => setActivatingAgent(null)} busy={activating}
          sub={[activatingAgent.agentId, activatingAgent.phone, activatingAgent.email].filter(Boolean).join(' · ')}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setActivatingAgent(null)} disabled={activating}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={activating} onClick={activateAgent}>{activating ? 'Activating…' : 'Activate account'}</button>
          </>}>
          <Field id="act-float" label="Float limit" hint="The most cash this agent can hold for customers." error={floatError}>
            <div className="ag-money">
              <span aria-hidden="true">₦</span>
              <input id="act-float" className="a-input" type="tel" inputMode="decimal" placeholder="200,000" value={floatLimit} aria-invalid={!!floatError}
                onKeyDown={blockMinus} onChange={e => { setFloatLimit(nonNegativeString(e.target.value)); setFloatError('') }} />
            </div>
          </Field>
          <Field id="act-region" label="Region (optional)">
            <select id="act-region" className="a-input" value={region} onChange={e => setRegion(e.target.value)}>
              <option value="">Choose a region</option>
              {REGIONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field id="act-notes" label="Internal note (optional)">
            <textarea id="act-notes" className="a-input" rows={2} placeholder="Only admins see this" value={activateNotes} onChange={e => setActivateNotes(e.target.value)} />
          </Field>
          <fieldset className="ag-docs">
            <legend className="a-label">Documents you’ve checked</legend>
            {DOCS.filter(d => d.required).map(doc => (
              <label key={doc.id} className="ag-doc-check">
                <input type="checkbox" checked={checkedDocs.includes(doc.id)}
                  onChange={() => setCheckedDocs(prev => prev.includes(doc.id) ? prev.filter(d => d !== doc.id) : [...prev, doc.id])} />
                <span>
                  <span className="ag-doc-title">{doc.label}</span>
                  <span className="ag-doc-sub">{doc.sub}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="a-hint">Commission uses the platform rates set under <Link href="/superadmin/commission">Commission</Link>. The agent is emailed and can sign in straight away.</p>
        </Modal>
      )}

      {reviewingAgent && (
        <Modal error={reviewError || undefined} icon="enrol" title="Review documents" sub={`${reviewingAgent.name} · ${reviewingAgent.agentId}`} onClose={closeReview} busy={docApproving}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={closeReview} disabled={docApproving}>Close</button>
            {reviewingAgent.documents?.some(d => d.docApprovalStatus !== 'approved') && (
              <button type="button" className="btn btn-green" onClick={approveAll} disabled={docApproving}>{docApproving ? 'Saving…' : 'Approve all'}</button>
            )}
          </>}>
          {reviewingAgent.documents && reviewingAgent.documents.length > 0 ? (
            <div className="rows">
              {reviewingAgent.documents.map(doc => {
                const s = doc.docApprovalStatus
                const href = `/api/admin/agents/${reviewingAgent.id}/documents/${encodeURIComponent(doc.docType)}`
                return (
                  <div key={doc.docType} className="row ag-review-row">
                    <span className="row-ic" aria-hidden="true"><Icons.enrol size={18} /></span>
                    <div className="row-main">
                      <div className="row-title">{docLabel(doc.docType)}</div>
                      <div className="row-sub">{doc.fileName}</div>
                      <span className={`bdg ${s === 'approved' ? 'bdg-g' : s === 'rejected' ? 'bdg-r' : 'bdg-a'}`}>{s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'To review'}</span>
                    </div>
                    <div className="row-actions">
                      {doc.docType === 'agree' && !/\.pdf$/i.test(doc.fileName)
                        ? <button type="button" className="btn btn-xs btn-outline" onClick={() => setViewingAgreement({ name: reviewingAgent.name, agentId: reviewingAgent.agentId, signatureUrl: href })}>View</button>
                        : <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline">View</a>}
                      {s !== 'approved' && <button type="button" className="btn btn-xs btn-green" disabled={docApproving} onClick={() => approveDocument(doc.docType)}>Approve</button>}
                      {s !== 'rejected' && <button type="button" className="btn btn-xs btn-outline ag-reject" disabled={docApproving} aria-pressed={selectedDocType === doc.docType}
                        onClick={() => { setSelectedDocType(doc.docType); setRejectionReason('') }}>Reject</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <Empty icon="enrol" title="No documents yet" text="This agent hasn’t uploaded anything." />}

          {selectedDocType && (
            <div className="ag-reject-box">
              <Field id="rej-reason" label={`Why are you rejecting the ${docLabel(selectedDocType).toLowerCase()}?`} hint="The agent sees this, so say what to fix.">
                <textarea id="rej-reason" className="a-input" rows={3} autoFocus placeholder="e.g. The photo is blurry. Upload a clearer picture of the whole ID." value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              </Field>
              <div className="a-row-actions">
                <button type="button" className="btn btn-sm btn-outline" onClick={() => { setSelectedDocType(''); setRejectionReason('') }} disabled={docApproving}>Cancel</button>
                <button type="button" className="btn btn-sm btn-danger" disabled={docApproving || !rejectionReason.trim()} onClick={() => rejectDocument(selectedDocType)}>Reject and tell the agent</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {viewingAgreement && (
        <Modal size="lg" icon="audit" title="Signed agent agreement" sub="Vochus Easy Save agent terms and conditions" onClose={() => setViewingAgreement(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setViewingAgreement(null)}>Close</button>}>
          <div className="ag-agreement">
            <h4>1. Agreement to terms</h4>
            <p>By becoming an agent for Vochus Easy Save, you agree to comply with all terms and conditions outlined in this agreement. This includes all operational guidelines, compliance requirements, and financial obligations.</p>
            <h4>2. Agent responsibilities</h4>
            <p>As an agent, you are responsible for: enrolling customers, recording savings transactions, maintaining accurate records, safeguarding customer funds, and reporting all transactions promptly. You must conduct all activities in accordance with applicable laws and platform policies.</p>
            <h4>3. Commission structure</h4>
            <p>Agents earn commission based on savings volume (0.4% of savings amount) and customer enrolments (₦2 per enrolment). Commission is calculated monthly and deposited into your agent wallet.</p>
            <h4>4. Float limit</h4>
            <p>You are allocated a float limit as specified during activation. You are responsible for safeguarding all funds up to this limit and must account for every transaction.</p>
            <h4>5. Compliance and conduct</h4>
            <p>You must comply with all KYC/AML requirements, maintain confidentiality of customer information, and conduct business with integrity. Any fraudulent activity will result in immediate account suspension and legal action.</p>
            <h4>6. Termination</h4>
            <p>Vochus reserves the right to terminate this agreement at any time if you violate terms, engage in misconduct, or fail to meet performance standards.</p>
            <h4>7. Liability</h4>
            <p>You acknowledge that you are an independent agent and not an employee. You are solely responsible for any losses or disputes arising from your activities.</p>
            <div className="ag-signature">
              <p className="a-label">Signed by {viewingAgreement.name}</p>
              <div className="ag-signature-box"><img src={viewingAgreement.signatureUrl} alt={`${viewingAgreement.name}’s signature`} /></div>
              <p className="a-hint">{viewingAgreement.agentId} · Signed during registration</p>
            </div>
          </div>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Suspend ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>They won’t be able to sign in or record savings until you reactivate them. Their {statusTarget.customerCount} customer{statusTarget.customerCount === 1 ? '' : 's'} and balances stay as they are.</>
            : <>They’ll be able to sign in and record savings again.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Suspend agent' : 'Reactivate agent'}
          danger={statusTarget.status === 'Active'}
          busy={statusBusy} error={statusError}
          onConfirm={changeStatus} onClose={() => setStatusTarget(null)}
        />
      )}

      {toastNode}
    </>
  )
}
