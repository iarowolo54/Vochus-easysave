'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Avatar, ConfirmModal, Empty, LoadError, Modal, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, naira, shortDate, useToast, AmountHero, Ledger, LedgerRow, DialogNote,
} from '../_components/admin-ui'

interface Loan {
  id: string
  ref: string
  principal: number
  interestRate: number
  totalAmount: number
  durationDays: number
  dueDate: string
  status: string
  approvedBy: string | null
  createdAt: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
}

type Tab = 'All' | 'Pending' | 'Approved' | 'Rejected' | 'Disbursed'
type Decision = { loan: Loan; action: 'approve' | 'reject' }

const PAGE_SIZE = 25

const STATUS: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'Waiting for decision', cls: 'bdg-a' },
  Approved: { label: 'Approved', cls: 'bdg-g' },
  Rejected: { label: 'Rejected', cls: 'bdg-r' },
  Disbursed: { label: 'Paid out', cls: 'bdg-b' },
  Repaid: { label: 'Repaid', cls: 'bdg-p' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bdg-grey' }
  return <span className={`bdg ${s.cls}`}>{s.label}</span>
}

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

const EMPTY: Record<Tab, { title: string; text: string }> = {
  All: { title: 'No loan requests yet', text: 'When an agent requests a loan for a customer, it shows here for you to approve or reject.' },
  Pending: { title: 'You’re all caught up', text: 'No loan requests are waiting for a decision.' },
  Approved: { title: 'No approved loans', text: 'Loans you approve show here until the agent pays them out.' },
  Rejected: { title: 'No rejected loans', text: 'Loans you reject show here.' },
  Disbursed: { title: 'No loans paid out', text: 'Approved loans show here once the money has been paid out.' },
}

export default function LoanRequestsPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [detailRecord, setDetailRecord] = useState<Loan | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState('')
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const q = activeTab !== 'All' ? `?status=${activeTab}` : ''
      const res = await fetch(`/api/admin/loans${q}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { loans?: Loan[] }
      setLoans(d.loans ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [activeTab, search])

  function askDecision(loan: Loan, action: 'approve' | 'reject') {
    setDecisionError('')
    setDecision({ loan, action })
  }

  async function handleAction() {
    if (!decision) return
    const { loan, action } = decision
    setDeciding(true); setDecisionError('')
    try {
      const res = await fetch(`/api/admin/loans/${loan.id}/${action}`, { method: 'PATCH' })
      if (!res.ok) {
        setDecisionError(await errorOf(res, action === 'approve' ? 'The loan wasn’t approved. Try again.' : 'The loan wasn’t rejected. Try again.'))
        return
      }
      toast(action === 'approve'
        ? `Loan ${loan.ref} approved. ${naira(loan.principal)} for ${loan.customerName}.`
        : `Loan ${loan.ref} for ${loan.customerName} rejected.`, 'success')
      setDecision(null)
      setDetailRecord(null)
      load()
    } catch {
      setDecisionError('No connection. Check your internet and try again.')
    } finally {
      setDeciding(false)
    }
  }

  const term = search.trim().toLowerCase()
  const shown = term
    ? loans.filter(l => [l.ref, l.customerName, l.customerId, l.agentName, l.agentId].some(v => v.toLowerCase().includes(term)))
    : loans
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pendingCount = loans.filter(l => l.status === 'Pending').length

  return (
    <>
      <PageHeader
        title="Loan requests"
        sub={activeTab === 'Pending' && !loading && !failed
          ? `${pendingCount} waiting for your decision`
          : 'Approve or reject loans agents have requested for their customers.'}
      />

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Loan ref, customer or agent" label="Search loan requests" />
        <Segmented<Tab> label="Filter by status" value={activeTab} onChange={setActiveTab} options={[
          { value: 'All', label: 'All' },
          { value: 'Pending', label: 'Waiting' },
          { value: 'Approved', label: 'Approved' },
          { value: 'Rejected', label: 'Rejected' },
          { value: 'Disbursed', label: 'Paid out' },
        ]} />
      </div>

      <section className="card" aria-label="Loan requests">
        {loading && !loans.length ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="loan requests" onRetry={load} />
          : shown.length === 0 ? (
            term ? <Empty icon="search" title={`No loans match “${search.trim()}”`} text="Check the spelling, or search by loan ref, customer ID or agent ID." />
              : <Empty icon={activeTab === 'Pending' ? 'check' : 'loan'} title={EMPTY[activeTab].title} text={EMPTY[activeTab].text} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Agent</th><th className="num">Amount</th><th>Term</th>
                      <th>Due</th><th>Status</th><th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(l => (
                      <tr key={l.id}>
                        <td>
                          <button type="button" className="lo-open" onClick={() => setDetailRecord(l)} aria-label={`View loan ${l.ref} for ${l.customerName}`}>
                            <Avatar name={l.customerName} tone={l.status === 'Pending' ? 'amber' : 'grey'} />
                            <span>
                              <span className="td-name ui-block">{l.customerName}</span>
                              <span className="td-sub ui-block"><span className="lo-ref">{l.ref}</span> · {l.customerId}</span>
                            </span>
                          </button>
                        </td>
                        <td data-label="Agent">
                          <div>
                            <div>{l.agentName}</div>
                            <div className="td-sub">{l.agentId}</div>
                          </div>
                        </td>
                        <td className="num" data-label="Amount">
                          <div>
                            <div className="lo-strong">{naira(l.principal)}</div>
                            <div className="td-sub">{naira(l.totalAmount)} to repay</div>
                          </div>
                        </td>
                        <td data-label="Term">{l.durationDays} days · {l.interestRate}%</td>
                        <td data-label="Due">{shortDate(l.dueDate)}</td>
                        <td data-label="Status">
                          <div>
                            <StatusBadge status={l.status} />
                            {l.approvedBy && <div className="td-sub">By {l.approvedBy}</div>}
                          </div>
                        </td>
                        <td>
                          <div className="a-row-actions">
                            {l.status === 'Pending' ? <>
                              <button type="button" className="btn btn-sm btn-green" onClick={() => askDecision(l, 'approve')}>Approve</button>
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => askDecision(l, 'reject')}>Reject</button>
                            </> : (
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => setDetailRecord(l)}>Details</button>
                            )}
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

      {detailRecord && !decision && (
        <Modal icon="loan" title={`Loan ${detailRecord.ref}`} sub={`${detailRecord.customerName} · requested ${shortDate(detailRecord.createdAt)}`}
          onClose={() => setDetailRecord(null)}
          footer={detailRecord.status === 'Pending' ? <>
            <button type="button" className="btn btn-outline" onClick={() => askDecision(detailRecord, 'reject')}>Reject</button>
            <button type="button" className="btn btn-green" onClick={() => askDecision(detailRecord, 'approve')}>Approve {naira(detailRecord.principal)}</button>
          </> : <button type="button" className="btn btn-outline" onClick={() => setDetailRecord(null)}>Close</button>}>
          <div className="lo-sheet-badges"><StatusBadge status={detailRecord.status} /></div>

          <h3 className="dlg-sec-h">Who it’s for</h3>
          <dl className="dlg-ledger">
            <div><dt>Customer</dt><dd>{detailRecord.customerName}</dd></div>
            <div><dt>Customer ID</dt><dd>{detailRecord.customerId}</dd></div>
            <div><dt>Agent</dt><dd>{detailRecord.agentName}</dd></div>
            <div><dt>Agent ID</dt><dd>{detailRecord.agentId}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Loan terms</h3>
          <dl className="dlg-ledger">
            <div><dt>Amount borrowed</dt><dd>{naira(detailRecord.principal)}</dd></div>
            <div><dt>Interest rate</dt><dd>{detailRecord.interestRate}%</dd></div>
            <div><dt>Total to repay</dt><dd>{naira(detailRecord.totalAmount)}</dd></div>
            <div><dt>Term</dt><dd>{detailRecord.durationDays} days</dd></div>
            <div><dt>Due date</dt><dd>{shortDate(detailRecord.dueDate)}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Decision</h3>
          <dl className="dlg-ledger">
            <div><dt>Requested</dt><dd>{shortDate(detailRecord.createdAt)}</dd></div>
            <div><dt>Approved by</dt><dd>{detailRecord.approvedBy ?? '—'}</dd></div>
          </dl>
        </Modal>
      )}

      {decision && (
        <ConfirmModal
          title={decision.action === 'approve' ? `Approve loan ${decision.loan.ref}?` : `Reject loan ${decision.loan.ref}?`}
          body={<>
            <AmountHero label={decision.action === 'approve' ? 'Loan to approve' : 'Loan to reject'} amount={naira(decision.loan.principal)}
              sub={<>For <strong>{decision.loan.customerName}</strong> ({decision.loan.customerId}), requested by {decision.loan.agentName}</>} />
            <Ledger>
              <LedgerRow label="Term">{decision.loan.durationDays} days at {decision.loan.interestRate}%</LedgerRow>
              <LedgerRow label="Due">{shortDate(decision.loan.dueDate)}</LedgerRow>
              <LedgerRow label="Total to repay" total>{naira(decision.loan.totalAmount)}</LedgerRow>
            </Ledger>
            <DialogNote warn={decision.action === 'reject'}>{decision.action === 'approve'
              ? `${decision.loan.agentName} can then pay it out to the customer from their wallet.`
              : 'The request is closed. The agent will need to send a new request if the customer still needs a loan.'}</DialogNote>
          </>}
          icon="loan" tone={decision.action === 'approve' ? 'money' : 'danger'}
          confirmLabel={decision.action === 'approve' ? `Approve ${naira(decision.loan.principal)}` : 'Reject loan'}
          danger={decision.action === 'reject'}
          busy={deciding} error={decisionError}
          onConfirm={handleAction} onClose={() => setDecision(null)}
        />
      )}

      {toastNode}
    </>
  )
}
