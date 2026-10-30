'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Avatar, Empty, LoadError, Modal, PageHeader, Pager, SearchField, TableSkeleton, dateTime, naira, nairaKobo, shortDate, useDebounced,
} from '../_components/admin-ui'

interface Repayment {
  id: string
  loanRef: string
  amount: number
  method: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  createdAt: string
}

interface Stats { totalRepayments: number; totalAmount: number; todayCount: number; todayAmount: number }

const PAGE_SIZE = 25

export default function LoanRepayPage() {
  const [repayments, setRepayments] = useState<Repayment[]>([])
  const [stats, setStats] = useState<Stats>({ totalRepayments: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 })
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [detailRecord, setDetailRecord] = useState<Repayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (date) params.set('date', date)
      const res = await fetch(`/api/admin/loan-repayments?${params}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<Stats> & { repayments?: Repayment[] }
      setRepayments(d.repayments ?? [])
      setStats({
        totalRepayments: d.totalRepayments ?? 0,
        totalAmount: d.totalAmount ?? 0,
        todayCount: d.todayCount ?? 0,
        todayAmount: d.todayAmount ?? 0,
      })
      setLoaded(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [q, date])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, date])

  const paginated = repayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtering = !!(q || date)
  const dash = !loaded

  return (
    <>
      <PageHeader title="Repayments" sub="Loan repayments agents have recorded for their customers." />

      {!loaded && failed ? null : (
        <div className="stats-grid" aria-busy={!loaded}>
          <div className="stat">
            <div className="stat-lbl">Repayments</div>
            <div className="stat-val">{dash ? '—' : stats.totalRepayments.toLocaleString('en-NG')}</div>
            <div className="stat-sub">All time</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Total repaid</div>
            <div className="stat-val">{dash ? '—' : naira(stats.totalAmount)}</div>
            <div className="stat-sub">All time</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Repayments today</div>
            <div className="stat-val">{dash ? '—' : stats.todayCount.toLocaleString('en-NG')}</div>
            <div className="stat-sub">Since midnight</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Repaid today</div>
            <div className="stat-val">{dash ? '—' : naira(stats.todayAmount)}</div>
            <div className="stat-sub">Since midnight</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Loan ref, customer or agent" label="Search repayments" />
        <label className="sr-only" htmlFor="rp-date">Show repayments on</label>
        <input id="rp-date" type="date" className="a-input lo-date" value={date} max={new Date().toLocaleDateString('en-CA')} onChange={e => setDate(e.target.value)} />
        {filtering && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setSearch(''); setDate('') }}>Clear filters</button>}
      </div>

      <section className="card" aria-label="Repayments">
        {loading && !loaded ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="repayments" onRetry={load} />
          : repayments.length === 0 ? (
            filtering
              ? <Empty icon="search" title="No repayments match" text={`Nothing found${q ? ` for “${q}”` : ''}${date ? ` on ${shortDate(date)}` : ''}. Try another search or date.`}
                  action={<button type="button" className="btn btn-outline" onClick={() => { setSearch(''); setDate('') }}>Clear filters</button>} />
              : <Empty icon="repay" title="No repayments yet" text="When an agent records a loan repayment, it shows here." />
          ) : (
            <>
              <p className="lo-count" aria-live="polite">
                {repayments.length.toLocaleString('en-NG')} repayment{repayments.length === 1 ? '' : 's'}
                {filtering ? ` · ${naira(repayments.reduce((s, r) => s + r.amount, 0))} in total` : ''}
              </p>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Loan</th><th>Agent</th><th className="num">Amount</th><th>Method</th><th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(r => (
                      <tr key={r.id}>
                        <td>
                          <button type="button" className="lo-open" onClick={() => setDetailRecord(r)} aria-label={`View repayment by ${r.customerName} on loan ${r.loanRef}`}>
                            <Avatar name={r.customerName} tone="grey" />
                            <span>
                              <span className="td-name ui-block">{r.customerName}</span>
                              <span className="td-sub ui-block">{r.customerId}</span>
                            </span>
                          </button>
                        </td>
                        <td data-label="Loan"><span className="lo-ref">{r.loanRef}</span></td>
                        <td data-label="Agent">
                          <div>
                            <div>{r.agentName}</div>
                            <div className="td-sub">{r.agentId}</div>
                          </div>
                        </td>
                        <td className="num lo-strong" data-label="Amount">{naira(r.amount)}</td>
                        <td data-label="Method">{r.method}</td>
                        <td data-label="Date">{dateTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={repayments.length} onPage={setPage} />
            </>
          )}
      </section>

      {detailRecord && (
        <Modal icon="repay" title="Loan repayment" sub={`Loan ${detailRecord.loanRef} · ${dateTime(detailRecord.createdAt)}`}
          onClose={() => setDetailRecord(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setDetailRecord(null)}>Close</button>}>
          <div className="lo-confirm-amt">{nairaKobo(detailRecord.amount)}</div>
          <dl className="dlg-ledger">
            <div><dt>Method</dt><dd>{detailRecord.method}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Customer</h3>
          <dl className="dlg-ledger">
            <div><dt>Name</dt><dd>{detailRecord.customerName}</dd></div>
            <div><dt>Customer ID</dt><dd>{detailRecord.customerId}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Recorded by</h3>
          <dl className="dlg-ledger">
            <div><dt>Agent</dt><dd>{detailRecord.agentName}</dd></div>
            <div><dt>Agent ID</dt><dd>{detailRecord.agentId}</dd></div>
          </dl>
        </Modal>
      )}
    </>
  )
}
