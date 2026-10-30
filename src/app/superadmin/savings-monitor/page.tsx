'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  Avatar, Empty, LoadError, Modal, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, naira, shortDate, useDebounced,
} from '../_components/admin-ui'

interface SavingsPlan {
  id: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  balance: number
  dailyAmount: number
  periodDays: number
  startDate: string
  maturityDate: string
  status: string
  goal: string
}

interface PageData {
  plans: SavingsPlan[]
  total: number
  totalActivePlans: number
  totalSavingsPool: number
  maturingThisWeek: number
  maturingToday: number
}

type Tab = 'All' | 'Active' | 'Matured' | 'Redeemed'
const PAGE_SIZE = 20 // the savings API's default page size

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'Active' ? 'bdg-g' : status === 'Matured' ? 'bdg-b' : 'bdg-grey'
  return <span className={`bdg ${cls}`}>{status}</span>
}

/** Days until maturity, for active plans only. */
function MaturityBadge({ maturityDate, status }: { maturityDate: string; status: string }) {
  if (status !== 'Active') return null
  // Whole calendar days, so a plan maturing later today is "Due today", not overdue.
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date(maturityDate)) - day(new Date())) / (1000 * 60 * 60 * 24))
  if (diff < 0) return <span className="bdg bdg-r">Overdue</span>
  if (diff === 0) return <span className="bdg bdg-a">Due today</span>
  if (diff <= 7) return <span className="bdg bdg-a">In {diff} day{diff === 1 ? '' : 's'}</span>
  return null
}

function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

export default function SavingsMonitorPage() {
  const [data, setData] = useState<PageData | null>(null)
  const [tab, setTab] = useState<Tab>('All')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [detail, setDetail] = useState<SavingsPlan | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (tab !== 'All') params.set('status', tab)
      if (q) params.set('search', q)
      params.set('page', String(page))
      const res = await fetch(`/api/admin/savings?${params}`)
      if (!res.ok) throw new Error()
      setData(await res.json() as PageData)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [tab, q, page])

  useEffect(() => { setPage(1) }, [tab, q])
  useEffect(() => { load() }, [load])

  const plans = data?.plans ?? []
  const firstLoad = loading && !data

  return (
    <>
      <PageHeader title="Savings monitor" sub="Every customer savings plan, across all agents." />

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-lbl">Active plans</div>
          <div className="stat-val">{data ? data.totalActivePlans.toLocaleString('en-NG') : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Held in active plans</div>
          <div className="stat-val">{data ? naira(data.totalSavingsPool) : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Maturing within 7 days</div>
          <div className={`stat-val${data?.maturingThisWeek ? ' amber' : ''}`}>{data ? data.maturingThisWeek.toLocaleString('en-NG') : '—'}</div>
          <div className="stat-sub">Includes any overdue</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Due today</div>
          <div className={`stat-val${data?.maturingToday ? ' red' : ''}`}>{data ? data.maturingToday.toLocaleString('en-NG') : '—'}</div>
          <div className="stat-sub">Includes any overdue</div>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Customer name or ID" label="Search savings plans" />
        <Segmented<Tab> label="Filter by plan status" value={tab} onChange={setTab} options={[
          { value: 'All', label: 'All' },
          { value: 'Active', label: 'Active' },
          { value: 'Matured', label: 'Matured' },
          { value: 'Redeemed', label: 'Redeemed' },
        ]} />
      </div>

      <section className="card" aria-label="Savings plans" aria-busy={loading}>
        {firstLoad || (loading && plans.length === 0) ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="savings plans" onRetry={load} />
          : plans.length === 0 ? (
            q ? <Empty icon="search" title={`No plans match “${q}”`} text="Check the spelling, or search by customer ID." />
              : tab !== 'All' ? <Empty icon="plan" title={`No ${tab.toLowerCase()} plans`} text="Nothing in this group right now." />
              : <Empty icon="plan" title="No savings plans yet" text="Plans show here once agents start enrolling customers." />
          ) : (
            <>
              <p className="cm-count">{(data?.total ?? 0).toLocaleString('en-NG')} plan{data?.total === 1 ? '' : 's'}{loading ? ' · Updating…' : ''}</p>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Agent</th><th className="num">Daily amount</th><th className="num">Period</th>
                      <th>Started</th><th>Matures</th><th className="num">Balance</th><th>Goal</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map(p => (
                      <tr key={p.id}>
                        <td>
                          <button type="button" className="cm-cell-btn" onClick={() => setDetail(p)} aria-label={`View plan for ${p.customerName}`}>
                            <Avatar name={p.customerName} tone="blue" />
                            <span>
                              <span className="td-name">{p.customerName}</span>
                              <span className="td-sub">{p.customerId}</span>
                            </span>
                          </button>
                        </td>
                        <td data-label="Agent">
                          <div className="td-name">{p.agentName}</div>
                          <div className="td-sub">{p.agentId}</div>
                        </td>
                        <td className="num" data-label="Daily amount">{naira(p.dailyAmount)}</td>
                        <td className="num" data-label="Period">{p.periodDays} days</td>
                        <td data-label="Started" className="cm-nowrap cm-sub2">{shortDate(p.startDate)}</td>
                        <td data-label="Matures">
                          <span className="cm-badges"><span className="cm-nowrap">{shortDate(p.maturityDate)}</span><MaturityBadge maturityDate={p.maturityDate} status={p.status} /></span>
                        </td>
                        <td className="num cm-strong" data-label="Balance">{naira(p.balance)}</td>
                        <td data-label="Goal"><span className="cm-truncate cm-sub2">{p.goal || '—'}</span></td>
                        <td data-label="Status"><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
            </>
          )}
      </section>

      {detail && (
        <Modal icon="plan" title={detail.customerName} sub={`${detail.customerId} · Savings plan`} onClose={() => setDetail(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>Close</button>}>
          <div className="dlg-hero">
            <div className="dlg-hero-lbl">Current balance</div>
            <div className="dlg-hero-amt">{naira(detail.balance)}</div>
            <span className="cm-badges"><StatusBadge status={detail.status} /><MaturityBadge maturityDate={detail.maturityDate} status={detail.status} /></span>
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Plan</h3>
            <dl className="dlg-ledger">
              <DlRow label="Daily amount">{naira(detail.dailyAmount)}</DlRow>
              <DlRow label="Period">{detail.periodDays} days</DlRow>
              <DlRow label="Goal">{detail.goal || '—'}</DlRow>
              <DlRow label="Started">{shortDate(detail.startDate)}</DlRow>
              <DlRow label="Matures">{shortDate(detail.maturityDate)}</DlRow>
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
