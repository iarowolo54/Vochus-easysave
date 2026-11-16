'use client'

// Customer → agent requests. The office sees the customer, their savings history, the details the agent sent and the
// agent who asked, then approves (which converts the person: customer account closed, agent account opened) or turns it
// down. Documents aren't part of the request: the new agent uploads their own, reviewed on the agent's page.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConfirmModal, DialogAlert, DialogNote, Empty, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Segmented, TableSkeleton,
  dateTime, nairaKobo, shortDate, useToast,
} from '../_components/admin-ui'
import NoAccess from '../_components/NoAccess'

type Status = 'Pending' | 'Approved' | 'Denied'
type DocsState = 'missing' | 'review' | 'rejected' | 'approved'

interface Row {
  id: string; status: Status; submittedAt: string; decidedAt: string | null; decidedBy: string | null; state: string; lga: string
  customer: { id: string; customerId: string; firstName: string; lastName: string; phone: string; createdAt: string }
  agent: { id: string; agentId: string; name: string }
}
interface Detail {
  request: {
    id: string; status: Status; nin: string; bvnLast4: string | null; state: string; lga: string; address: string; nokName: string; nokPhone: string
    submittedAt: string; decidedAt: string | null; decidedBy: string | null
    denyReason: string | null; denyFix: string | null
    agent: { id: string; agentId: string; name: string; phone: string; location: string }
    customer: {
      id: string; customerId: string; firstName: string; lastName: string; phone: string; email: string | null; emailVerifiedAt: string | null; dob: string | null; gender: string | null
      address: string; state: string | null; lga: string | null; nokName: string; nokRelation: string; nokPhone: string; photoUrl: string | null; status: string; type: string; createdAt: string; walletBalance: number
    }
  }
  summary: {
    accountAgeDays: number; totalSaved: number; savingsCount: number; firstSavingAt: string | null; lastSavingAt: string | null; daysSavedLast90: number
    plansByStatus: Record<string, number>; earlyRedemptions: number
    plans: { id: string; goal: string; status: string; cadence: string; dailyAmount: number; periodDays: number; balance: number; startDate: string; maturityDate: string }[]
    savings: { ref: string; amount: number; method: string | null; createdAt: string; planId: string | null; paidByAgentId: string | null }[]
    redemptions: { ref: string; type: string; status: string; netPayout: number; penalty: number; requestedAt: string }[]
  }
  blockers: string[]
  conflict: 'phone' | 'email' | null
  newAgent: { id: string; agentId: string; documents: DocsState; docs: { label: string; status: string }[] } | null
  canManage: boolean
}

const BADGE: Record<Status, string> = { Pending: 'bdg-a', Approved: 'bdg-g', Denied: 'bdg-r' }
const LABEL: Record<Status, string> = { Pending: 'Waiting', Approved: 'Approved', Denied: 'Not approved' }
const DOCS_LABEL: Record<DocsState, string> = { missing: 'Not all sent yet', review: 'Waiting for review', rejected: 'Some need a new file', approved: 'All approved' }
const DOC_STATUS: Record<string, string> = { missing: 'Not sent', pending: 'Waiting for review', approved: 'Approved', rejected: 'Needs a new file' }

async function errorText(res: Response, fallback: string) {
  const d = await res.json().catch(() => null) as { error?: string } | null
  return d?.error || fallback
}

export default function AgentRequestsPage() {
  const [filter, setFilter] = useState<Status>('Pending')
  const [data, setData] = useState<{ requests: Row[]; counts: Partial<Record<Status, number>> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<'error' | 'forbidden' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [toastNode, toast] = useToast()
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true); setFailed(null)
    try {
      const res = await fetch(`/api/admin/agent-upgrade-requests?status=${filter}`, { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { if (mine === seq.current) setFailed('forbidden'); return }
      if (!res.ok) throw new Error()
      const d = await res.json()
      if (mine === seq.current) setData(d)
    } catch {
      if (mine === seq.current) setFailed('error')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [filter])
  useEffect(() => { load() }, [load])

  if (failed === 'forbidden') return <NoAccess area="agent requests" />
  const c = data?.counts
  const options: { value: Status; label: string; count?: number }[] = [
    { value: 'Pending', label: 'Waiting', count: c?.Pending ?? 0 },
    { value: 'Approved', label: 'Approved', count: c?.Approved ?? 0 },
    { value: 'Denied', label: 'Not approved', count: c?.Denied ?? 0 },
  ]

  return (
    <>
      <PageHeader title="Agent requests" sub="Online customers an agent wants to make agents. Approving closes their customer account and opens an agent account with the same phone, email and password. They then upload their own documents, which you review on their agent page." />
      <div className="toolbar bt-toolbar">
        <Segmented label="Status" value={filter} options={options} onChange={setFilter} />
      </div>
      <section className="card" aria-label="Agent requests" aria-busy={loading}>
        {loading && !data ? <TableSkeleton rows={6} cols={4} />
          : failed || !data ? <LoadError what="agent requests" onRetry={load} />
          : data.requests.length === 0 ? <Empty icon="customers" title={filter === 'Pending' ? 'Nothing waiting' : 'No requests here'} text="Requests show here when an agent sends one." />
          : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead><tr><th>Sent</th><th>Customer</th><th>Asked by</th><th>Status</th></tr></thead>
                <tbody>
                  {data.requests.map(r => (
                    <tr key={r.id} className="bt-row" onClick={() => setOpenId(r.id)}>
                      <td data-label="Sent" className="cm-nowrap cm-sub2">
                        <button type="button" className="cm-cell-btn" aria-label={`Open the request for ${r.customer.firstName} ${r.customer.lastName}`}
                          onClick={e => { e.stopPropagation(); setOpenId(r.id) }}>{dateTime(r.submittedAt)}</button>
                      </td>
                      <td data-label="Customer">
                        <div className="td-name">{r.customer.firstName} {r.customer.lastName}</div>
                        <div className="td-sub">{r.customer.customerId} · since {shortDate(r.customer.createdAt)}</div>
                      </td>
                      <td data-label="Asked by"><div className="td-name">{r.agent.name}</div><div className="td-sub">{r.agent.agentId}</div></td>
                      <td data-label="Status"><span className={`bdg ${BADGE[r.status]}`}>{LABEL[r.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      {openId && <RequestDialog id={openId} onClose={() => setOpenId(null)} onDone={msg => { setOpenId(null); toast(msg, 'success'); load() }} />}
      {toastNode}
    </>
  )
}

function RequestDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<'view' | 'approve' | 'deny'>('view')
  const [reason, setReason] = useState('')
  const [fix, setFix] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [allSavings, setAllSavings] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    fetch(`/api/admin/agent-upgrade-requests/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(res => { if (!res.ok) throw new Error(); return res.json() })
      .then(setD)
      .catch(() => setLoadFailed(true))
  }, [id])
  useEffect(() => { load() }, [load])

  async function decide(action: 'approve' | 'deny') {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/admin/agent-upgrade-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: action === 'deny' ? JSON.stringify({ reason, fix }) : '{}',
      })
      if (!res.ok) { setError(await errorText(res, 'That didn’t work. Please try again.')); return }
      const out = await res.json() as { newAgentCode?: string }
      onDone(action === 'approve' ? `Approved. They are now agent ${out.newAgentCode}.` : 'Not approved. The agent and customer have been told.')
    } catch {
      setError('No connection. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!d) return <Modal title="Agent request" onClose={onClose}>{loadFailed ? <LoadError what="this request" onRetry={load} /> : <TableSkeleton rows={4} cols={2} />}</Modal>

  const { request: r, summary: s } = d
  const c = r.customer
  const name = `${c.firstName} ${c.lastName}`
  const canDecide = r.status === 'Pending' && d.canManage
  const blocked = d.blockers.length > 0 || !!d.conflict
  const planGoal = new Map(s.plans.map(p => [p.id, p.goal]))
  const savingsShown = allSavings ? s.savings : s.savings.slice(0, 20)

  if (mode === 'approve') return (
    <ConfirmModal title={`Make ${name} an agent?`} confirmLabel="Approve" busy={busy} error={error}
      body={<>Their customer account {c.customerId} closes and they can no longer sign in to it. A new agent account opens with the same phone, email and password. They can only upload their documents until you approve them. This can’t be undone here.</>}
      onConfirm={() => decide('approve')} onClose={() => { setMode('view'); setError('') }} />
  )
  if (mode === 'deny') {
    const ready = reason.trim().length >= 3 && fix.trim().length >= 3
    return (
      <Modal title={`Don’t approve ${name}`} sub="The agent sees both of these and can send it again. The customer isn’t told." tone="danger" icon="error" busy={busy} error={error}
        onClose={onClose} onBack={() => { setMode('view'); setError('') }}
        footer={<button type="button" className="btn btn-danger" disabled={busy || !ready} onClick={() => decide('deny')}>{busy ? 'Sending…' : 'Turn down'}</button>}>
        <Field id="ar-reason" label="Reason"><textarea id="ar-reason" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <Field id="ar-fix" label="What to work on"><textarea id="ar-fix" rows={3} maxLength={500} value={fix} onChange={e => setFix(e.target.value)} /></Field>
      </Modal>
    )
  }

  return (
    <Modal title={name} sub={`Asked by ${r.agent.name} (${r.agent.agentId}) · ${dateTime(r.submittedAt)}`} size="lg" onClose={onClose}
      footnote={canDecide && blocked ? 'Approve is off until the points above are cleared.' : undefined}
      footer={canDecide ? (
        <>
          <button type="button" className="btn btn-outline" onClick={() => setMode('deny')}>Turn down</button>
          <button type="button" className="btn btn-primary" disabled={blocked} onClick={() => setMode('approve')}>Approve</button>
        </>
      ) : undefined}>
      {r.status === 'Pending' && (d.blockers.length > 0 || d.conflict) && (
        <DialogAlert title="Can’t approve yet">
          <ul className="ar-list">
            {d.blockers.map(b => <li key={b}>{b}</li>)}
            {d.conflict && <li>This {d.conflict === 'phone' ? 'phone number' : 'email'} belongs to another account.</li>}
          </ul>
        </DialogAlert>
      )}
      <div className="cr-review">
        <div className="cr-photo">
          {c.photoUrl
            ? <a href={c.photoUrl} target="_blank" rel="noreferrer" aria-label="Open the photo full size"><img src={c.photoUrl} alt={`Photo of ${name}`} /></a>
            : <p className="cm-muted">No photo</p>}
        </div>
        <div className="cr-facts">
          {r.status === 'Denied' && (
            <Ledger title="Not approved">
              <LedgerRow label="Reason">{r.denyReason}</LedgerRow>
              <LedgerRow label="To work on">{r.denyFix}</LedgerRow>
            </Ledger>
          )}
          {r.decidedAt && (
            <Ledger title="Decision">
              <LedgerRow label="By">{r.decidedBy}</LedgerRow>
              <LedgerRow label="When">{dateTime(r.decidedAt)}</LedgerRow>
              {d.newAgent && <LedgerRow label="Agent ID">{d.newAgent.agentId}</LedgerRow>}
            </Ledger>
          )}
          {d.newAgent && (
            <Ledger title={`Their documents: ${DOCS_LABEL[d.newAgent.documents]}`}>
              {d.newAgent.docs.map(x => <LedgerRow key={x.label} label={x.label}>{DOC_STATUS[x.status] ?? x.status}</LedgerRow>)}
              <LedgerRow label="Review">On the agent’s page under All agents</LedgerRow>
            </Ledger>
          )}
          <Ledger title="Savings history">
            <LedgerRow label="Customer since">{shortDate(c.createdAt)} ({s.accountAgeDays} days)</LedgerRow>
            <LedgerRow label="Total saved">{nairaKobo(s.totalSaved)} in {s.savingsCount} payment{s.savingsCount === 1 ? '' : 's'}</LedgerRow>
            <LedgerRow label="Saved on">{s.daysSavedLast90} of the last 90 days</LedgerRow>
            <LedgerRow label="Last saving">{s.lastSavingAt ? shortDate(s.lastSavingAt) : 'Never'}</LedgerRow>
            <LedgerRow label="Plans">{Object.entries(s.plansByStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'None'}</LedgerRow>
            <LedgerRow label="Early redemptions">{s.earlyRedemptions}</LedgerRow>
          </Ledger>
          <Ledger title="Customer">
            <LedgerRow label="Customer ID">{c.customerId}</LedgerRow>
            <LedgerRow label="Phone">{c.phone}</LedgerRow>
            {c.email && <LedgerRow label="Email">{c.email}{c.emailVerifiedAt ? '' : ' (not confirmed)'}</LedgerRow>}
            {c.gender && <LedgerRow label="Gender">{c.gender}</LedgerRow>}
            {c.dob && <LedgerRow label="Date of birth">{shortDate(c.dob)}</LedgerRow>}
          </Ledger>
          <Ledger title="Agent details">
            <LedgerRow label="NIN">{r.nin}</LedgerRow>
            {r.bvnLast4 && <LedgerRow label="BVN">•••• {r.bvnLast4}</LedgerRow>}
            <LedgerRow label="Address">{r.address}, {r.lga}, {r.state}</LedgerRow>
            <LedgerRow label="Next of kin">{r.nokName}, {r.nokPhone}</LedgerRow>
          </Ledger>
          <Ledger title="Asked by">
            <LedgerRow label="Agent">{r.agent.name} ({r.agent.agentId})</LedgerRow>
            <LedgerRow label="Phone">{r.agent.phone}</LedgerRow>
            <LedgerRow label="Area">{r.agent.location}</LedgerRow>
          </Ledger>
        </div>
      </div>

      <h3 className="ar-h">Plans</h3>
      {s.plans.length === 0 ? <DialogNote>No plans.</DialogNote> : (
        <div className="tbl-wrap tbl-stack">
          <table>
            <thead><tr><th>Plan</th><th>Dates</th><th>Balance</th><th>Status</th></tr></thead>
            <tbody>
              {s.plans.map(p => (
                <tr key={p.id}>
                  <td data-label="Plan"><div className="td-name">{p.goal}</div><div className="td-sub">{p.cadence}, {p.periodDays} days</div></td>
                  <td data-label="Dates" className="cm-nowrap">{shortDate(p.startDate)} to {shortDate(p.maturityDate)}</td>
                  <td data-label="Balance">{nairaKobo(p.balance)}</td>
                  <td data-label="Status">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="ar-h">Savings</h3>
      {s.savings.length === 0 ? <DialogNote>No savings yet.</DialogNote> : (
        <>
          <div className="tbl-wrap tbl-stack">
            <table>
              <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>How</th></tr></thead>
              <tbody>
                {savingsShown.map(t => (
                  <tr key={t.ref}>
                    <td data-label="Date" className="cm-nowrap">{dateTime(t.createdAt)}</td>
                    <td data-label="Plan">{(t.planId && planGoal.get(t.planId)) || '—'}</td>
                    <td data-label="Amount">{nairaKobo(t.amount)}</td>
                    <td data-label="How">{t.paidByAgentId ? 'Paid by agent' : t.method ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.savings.length > 20 && !allSavings && <button type="button" className="btn btn-outline ar-more" onClick={() => setAllSavings(true)}>Show all {s.savings.length}</button>}
        </>
      )}

      {s.redemptions.length > 0 && (
        <>
          <h3 className="ar-h">Redemptions</h3>
          <div className="tbl-wrap tbl-stack">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Paid out</th><th>Status</th></tr></thead>
              <tbody>
                {s.redemptions.map(x => (
                  <tr key={x.ref}>
                    <td data-label="Date" className="cm-nowrap">{dateTime(x.requestedAt)}</td>
                    <td data-label="Type">{x.type === 'early' ? 'Early' : 'At the end'}</td>
                    <td data-label="Paid out">{nairaKobo(x.netPayout)}{x.penalty > 0 ? ` (fee ${nairaKobo(x.penalty)})` : ''}</td>
                    <td data-label="Status">{x.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}
