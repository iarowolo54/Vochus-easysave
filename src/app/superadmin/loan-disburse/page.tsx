'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Avatar, Empty, LoadError, Modal, PageHeader, Pager, SearchField, Segmented, TableSkeleton, naira, shortDate,
} from '../_components/admin-ui'

interface DisbursedLoan {
  id: string
  ref: string
  principal: number
  totalAmount: number
  interestRate: number
  durationDays: number
  dueDate: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  createdAt: string
  disbursedAt?: string | null
  approvedBy: string | null
  outstanding: number
  isOverdue: boolean
}

interface Stats { totalDisbursed: number; totalDisbursedAmount: number; totalOutstanding: number; overdueCount: number }
type Tab = 'all' | 'overdue'

const PAGE_SIZE = 25
const DAY = 1000 * 60 * 60 * 24

function dueState(loan: DisbursedLoan): { label: string; cls: string } {
  if (loan.outstanding <= 0) return { label: 'Settled', cls: 'bdg-g' }
  if (loan.isOverdue) return { label: 'Overdue', cls: 'bdg-r' }
  const diff = Math.floor((new Date(loan.dueDate).getTime() - Date.now()) / DAY)
  if (diff <= 7) return { label: 'Due soon', cls: 'bdg-a' }
  return { label: 'On track', cls: 'bdg-b' }
}

function DueBadge({ loan }: { loan: DisbursedLoan }) {
  const s = dueState(loan)
  return <span className={`bdg ${s.cls}`}>{s.label}</span>
}

export default function LoanDisbursePage() {
  const [loans, setLoans] = useState<DisbursedLoan[]>([])
  const [stats, setStats] = useState<Stats>({ totalDisbursed: 0, totalDisbursedAmount: 0, totalOutstanding: 0, overdueCount: 0 })
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [detailRecord, setDetailRecord] = useState<DisbursedLoan | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/loan-disbursements')
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<Stats> & { loans?: DisbursedLoan[] }
      setLoans(d.loans ?? [])
      setStats({
        totalDisbursed: d.totalDisbursed ?? 0,
        totalDisbursedAmount: d.totalDisbursedAmount ?? 0,
        totalOutstanding: d.totalOutstanding ?? 0,
        overdueCount: d.overdueCount ?? 0,
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [tab, search])

  const term = search.trim().toLowerCase()
  const filtered = (tab === 'overdue' ? loans.filter(l => l.isOverdue) : loans)
    .filter(l => !term || [l.ref, l.customerName, l.customerId, l.agentName, l.agentId].some(v => v.toLowerCase().includes(term)))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const firstLoad = loading && !loans.length

  return (
    <>
      <PageHeader title="Disbursements" sub="Loans agents have paid out to customers, and what’s still owed on them." />

      {failed && !loans.length ? null : (
        <div className="stats-grid" aria-busy={firstLoad}>
          <div className="stat">
            <div className="stat-lbl">Loans paid out</div>
            <div className="stat-val">{firstLoad ? '—' : stats.totalDisbursed.toLocaleString('en-NG')}</div>
            <div className="stat-sub">Currently with customers</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Amount lent</div>
            <div className="stat-val">{firstLoad ? '—' : naira(stats.totalDisbursedAmount)}</div>
            <div className="stat-sub">Total borrowed</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Still owed</div>
            <div className="stat-val">{firstLoad ? '—' : naira(stats.totalOutstanding)}</div>
            <div className="stat-sub">Including interest</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Overdue</div>
            <div className={`stat-val${stats.overdueCount > 0 ? ' red' : ''}`}>{firstLoad ? '—' : stats.overdueCount.toLocaleString('en-NG')}</div>
            <div className="stat-sub">{stats.overdueCount === 1 ? 'Loan past its due date' : 'Loans past their due date'}</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Loan ref, customer or agent" label="Search disbursed loans" />
        <Segmented<Tab> label="Filter loans" value={tab} onChange={setTab} options={[
          { value: 'all', label: 'All', count: loans.length },
          { value: 'overdue', label: 'Overdue', count: stats.overdueCount },
        ]} />
      </div>

      <section className="card" aria-label="Disbursed loans">
        {firstLoad ? <TableSkeleton rows={8} cols={7} />
          : failed ? <LoadError what="disbursed loans" onRetry={load} />
          : filtered.length === 0 ? (
            term ? <Empty icon="search" title={`No loans match “${search.trim()}”`} text="Check the spelling, or search by loan ref, customer ID or agent ID." />
              : tab === 'overdue' ? <Empty icon="check" title="No overdue loans" text="Every paid-out loan is within its due date or settled." />
              : <Empty icon="cash" title="No loans paid out yet" text="Once an agent pays out an approved loan, it shows here." />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Agent</th><th className="num">Borrowed</th><th className="num">To repay</th>
                      <th className="num">Still owed</th><th>Due</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(l => (
                      <tr key={l.id}>
                        <td>
                          <button type="button" className="lo-open" onClick={() => setDetailRecord(l)} aria-label={`View loan ${l.ref} for ${l.customerName}`}>
                            <Avatar name={l.customerName} tone={l.isOverdue ? 'red' : 'grey'} />
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
                        <td className="num" data-label="Borrowed">{naira(l.principal)}</td>
                        <td className="num" data-label="To repay">
                          <div>
                            <div>{naira(l.totalAmount)}</div>
                            <div className="td-sub">{l.interestRate}% interest</div>
                          </div>
                        </td>
                        <td className="num lo-strong" data-label="Still owed">{naira(l.outstanding)}</td>
                        <td data-label="Due" className={l.isOverdue ? 'lo-bad' : undefined}>{shortDate(l.dueDate)}</td>
                        <td data-label="Status"><DueBadge loan={l} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
            </>
          )}
      </section>

      {detailRecord && (
        <Modal icon="cash" title={`Loan ${detailRecord.ref}`} sub={`${detailRecord.customerName} · requested ${shortDate(detailRecord.createdAt)}`}
          onClose={() => setDetailRecord(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setDetailRecord(null)}>Close</button>}>
          <div className="lo-sheet-badges"><DueBadge loan={detailRecord} /></div>

          <h3 className="dlg-sec-h">Who it’s for</h3>
          <dl className="dlg-ledger">
            <div><dt>Customer</dt><dd>{detailRecord.customerName}</dd></div>
            <div><dt>Customer ID</dt><dd>{detailRecord.customerId}</dd></div>
            <div><dt>Agent</dt><dd>{detailRecord.agentName}</dd></div>
            <div><dt>Agent ID</dt><dd>{detailRecord.agentId}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Loan</h3>
          <dl className="dlg-ledger">
            <div><dt>Amount borrowed</dt><dd>{naira(detailRecord.principal)}</dd></div>
            <div><dt>Interest rate</dt><dd>{detailRecord.interestRate}%</dd></div>
            <div><dt>Total to repay</dt><dd>{naira(detailRecord.totalAmount)}</dd></div>
            <div><dt>Term</dt><dd>{detailRecord.durationDays} days</dd></div>
            <div><dt>Still owed</dt><dd>{naira(detailRecord.outstanding)}</dd></div>
          </dl>

          <h3 className="dlg-sec-h">Dates and decision</h3>
          <dl className="dlg-ledger">
            <div><dt>Requested</dt><dd>{shortDate(detailRecord.createdAt)}</dd></div>
            {detailRecord.disbursedAt && <div><dt>Disbursed</dt><dd>{shortDate(detailRecord.disbursedAt)}</dd></div>}
            <div><dt>Due date</dt><dd className={detailRecord.isOverdue ? 'lo-bad' : undefined}>{shortDate(detailRecord.dueDate)}{detailRecord.isOverdue ? ' (overdue)' : ''}</dd></div>
            <div><dt>Approved by</dt><dd>{detailRecord.approvedBy ?? '—'}</dd></div>
          </dl>
        </Modal>
      )}
    </>
  )
}
