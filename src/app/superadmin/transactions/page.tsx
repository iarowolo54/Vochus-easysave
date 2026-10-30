'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  Empty, Field, LoadError, Modal, PageHeader, Pager, TableSkeleton, dateTime, nairaKobo,
} from '../_components/admin-ui'

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  method: string | null
  status: string
  createdAt: string
  agentName: string
  agentId: string
  customerName: string | null
  customerId: string | null
}

// Filter options — the values sent to the API are unchanged.
const TYPES = ['', 'saving', 'redemption', 'disbursement', 'repayment', 'enrolment']
const TYPE_LABELS: Record<string, string> = {
  '': 'All types',
  saving: 'Savings',
  redemption: 'Redemptions',
  disbursement: 'Loan disbursements',
  repayment: 'Loan repayments',
  enrolment: 'Enrolments',
}
// Display names for single rows, including types that appear in "All types" but aren't filterable yet.
const ROW_LABELS: Record<string, string> = {
  saving: 'Saving',
  redemption: 'Redemption',
  disbursement: 'Loan disbursement',
  repayment: 'Loan repayment',
  enrolment: 'Enrolment',
  registration: 'Registration',
  wallet_funding: 'Wallet funding',
  commission_payout: 'Commission payout',
}
const TYPE_BADGE: Record<string, string> = {
  saving: 'bdg-g',
  redemption: 'bdg-b',
  disbursement: 'bdg-a',
  repayment: 'bdg-p',
  enrolment: 'bdg-grey',
}
const typeLabel = (t: string) => ROW_LABELS[t] ?? t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

const PAGE_SIZE = 25
const API_LIMIT = 200 // the transactions API returns at most this many, newest first

function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`bdg ${status === 'Done' ? 'bdg-g' : 'bdg-a'}`}>{status}</span>
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [detail, setDetail] = useState<Transaction | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (date) params.set('date', date)
      const q = params.toString() ? `?${params}` : ''
      const res = await fetch(`/api/admin/transactions${q}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { transactions?: Transaction[] }
      setTransactions(d.transactions ?? [])
      setPage(1)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [type, date])

  useEffect(() => { load() }, [load])

  const filtered = !!(type || date)
  const paginated = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <PageHeader title="Transactions" sub="Every transaction on the platform, across agents and customers. Newest first." />

      <div className="toolbar">
        <div className="cm-toolbar-field">
          <label className="a-label" htmlFor="tx-type">Type</label>
          <select id="tx-type" className="a-input cm-select" value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="cm-toolbar-field">
          <label className="a-label" htmlFor="tx-date">Date</label>
          <input id="tx-date" type="date" className="a-input cm-date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        {filtered && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setType(''); setDate('') }}>Clear filters</button>}
      </div>

      <section className="card" aria-label="Transactions" aria-busy={loading}>
        {loading ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="transactions" onRetry={load} />
          : transactions.length === 0 ? (
            filtered
              ? <Empty icon="history" title="No transactions match these filters" text="Try another date or type, or clear the filters."
                  action={<button type="button" className="btn btn-outline" onClick={() => { setType(''); setDate('') }}>Clear filters</button>} />
              : <Empty icon="history" title="No transactions yet" text="Savings, redemptions and loan payments show here as they happen." />
          ) : (
            <>
              <p className="cm-count">
                {transactions.length.toLocaleString('en-NG')} transaction{transactions.length === 1 ? '' : 's'}
                {transactions.length >= API_LIMIT && ` · Showing the latest ${API_LIMIT}. Filter by date to see older ones.`}
              </p>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Reference</th><th>Type</th><th>Customer</th><th>Agent</th>
                      <th className="num">Amount</th><th>Method</th><th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(t => (
                      <tr key={t.id}>
                        <td>
                          <button type="button" className="cm-cell-btn" onClick={() => setDetail(t)} aria-label={`View transaction ${t.ref}`}>
                            <span className="cm-ref">{t.ref}</span>
                          </button>
                        </td>
                        <td data-label="Type"><span className={`bdg ${TYPE_BADGE[t.type] ?? 'bdg-grey'}`}>{typeLabel(t.type)}</span></td>
                        <td data-label="Customer">
                          {t.customerName ? (
                            <>
                              <div className="td-name">{t.customerName}</div>
                              <div className="td-sub">{t.customerId}</div>
                            </>
                          ) : <span className="cm-muted">—</span>}
                        </td>
                        <td data-label="Agent">
                          <div className="td-name">{t.agentName}</div>
                          <div className="td-sub">{t.agentId}</div>
                        </td>
                        <td className="num cm-strong" data-label="Amount">{t.amount > 0 ? nairaKobo(t.amount) : <span className="cm-muted">—</span>}</td>
                        <td data-label="Method" className="cm-sub2">{t.method ?? '—'}</td>
                        <td data-label="Date" className="cm-nowrap cm-sub2">{dateTime(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={transactions.length} onPage={setPage} />
            </>
          )}
      </section>

      {detail && (
        <Modal icon="history" title={typeLabel(detail.type)} sub={<span className="cm-ref">{detail.ref}</span>} onClose={() => setDetail(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>Close</button>}>
          <div className="dlg-hero">
            <div className="dlg-hero-lbl">Amount</div>
            <div className="dlg-hero-amt">{detail.amount > 0 ? nairaKobo(detail.amount) : '—'}</div>
            <StatusBadge status={detail.status} />
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Transaction</h3>
            <dl className="dlg-ledger">
              <DlRow label="Reference"><span className="cm-ref">{detail.ref}</span></DlRow>
              <DlRow label="Method">{detail.method ?? '—'}</DlRow>
              <DlRow label="Date">{dateTime(detail.createdAt)}</DlRow>
            </dl>
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Customer</h3>
            <dl className="dlg-ledger">
              <DlRow label="Name">{detail.customerName ?? '—'}</DlRow>
              <DlRow label="Customer ID">{detail.customerId ?? '—'}</DlRow>
            </dl>
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Agent</h3>
            <dl className="dlg-ledger">
              <DlRow label="Name">{detail.agentName}</DlRow>
              <DlRow label="Agent ID">{detail.agentId}</DlRow>
            </dl>
          </div>
        </Modal>
      )}
    </>
  )
}
