'use client'

import DatePicker from '@/components/ui/DatePicker'
import { isoDate, today } from '@/lib/plan-dates'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons, type IconName } from '@/components/ui/icons'
import { displayName, formatNaira, formatTime } from '@/lib/format'

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  method: string | null
  status: string
  createdAt: string
  customer: { name: string; customerId: string } | null
}

interface Stats {
  todaySavings: number; todaySavingsCount: number
  todayRedemptions: number; todayRedemptionsCount: number
  todayRepayments: number; todayRepaymentsCount: number
  totalVolume: number; totalCount: number
}

const TYPES: Record<string, { label: string; icon: IconName; sign: '+' | '−' | '' }> = {
  saving: { label: 'Saving', icon: 'deposit', sign: '+' },
  redemption: { label: 'Collection', icon: 'withdraw', sign: '−' },
  repayment: { label: 'Loan repayment', icon: 'repay', sign: '+' },
  disbursement: { label: 'Loan paid out', icon: 'withdraw', sign: '−' },
  enrolment: { label: 'New customer', icon: 'enrol', sign: '' },
  registration: { label: 'Registration fee', icon: 'enrol', sign: '' },
  loan: { label: 'Loan request', icon: 'loan', sign: '' },
  wallet_funding: { label: 'Wallet top-up', icon: 'wallet', sign: '+' },
}
const meta = (t: string) => TYPES[t] ?? { label: t.charAt(0).toUpperCase() + t.slice(1), icon: 'history' as IconName, sign: '' as const }

const FILTERS: { v: string; l: string }[] = [
  { v: '', l: 'All' },
  { v: 'saving', l: 'Savings' },
  { v: 'redemption', l: 'Collections' },
  { v: 'repayment', l: 'Repayments' },
  { v: 'disbursement', l: 'Loans paid out' },
  { v: 'loan', l: 'Loan requests' },
  { v: 'enrolment', l: 'Enrolments' },
  { v: 'wallet_funding', l: 'Wallet' },
]

const PAGE_SIZE = 20

function dayLabel(d: Date) {
  const today = new Date()
  const y = new Date(today); y.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (date) params.set('date', date)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    try {
      const res = await fetch(`/api/transactions?${params}`)
      const data = await res.json()
      setTransactions(data.transactions ?? [])
      setTotal(data.total ?? 0)
      setStats(data.stats ?? null)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }, [type, date, page])

  useEffect(() => { load() }, [load])

  const sections = useMemo(() => {
    const out: { label: string; items: Transaction[] }[] = []
    for (const t of transactions) {
      const label = dayLabel(new Date(t.createdAt))
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(t)
      else out.push({ label, items: [t] })
    }
    return out
  }, [transactions])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const filtered = !!(type || date)

  return (
    <div className="ag-page">
      <section className="ag-tx-today" aria-label="Today">
        <div className="ag-tx-today-main">
          <span className="ui-row-sub">Today’s activity</span>
          <span className="ag-funded-value">{formatNaira(stats?.totalVolume ?? 0, { minor: false })}</span>
          <span className="ui-row-sub">{stats?.totalCount ?? 0} transaction{stats?.totalCount === 1 ? '' : 's'}</span>
        </div>
        <dl className="ag-tx-today-split">
          <div>
            <dt><span className="ag-dot ag-dot--cash" aria-hidden="true" />Savings in</dt>
            <dd>{formatNaira(stats?.todaySavings ?? 0, { minor: false })}<span>{stats?.todaySavingsCount ?? 0}</span></dd>
          </div>
          <div>
            <dt><span className="ag-dot ag-dot--out" aria-hidden="true" />Collections out</dt>
            <dd>{formatNaira(stats?.todayRedemptions ?? 0, { minor: false })}<span>{stats?.todayRedemptionsCount ?? 0}</span></dd>
          </div>
          <div>
            <dt><span className="ag-dot ag-dot--loan" aria-hidden="true" />Repayments</dt>
            <dd>{formatNaira(stats?.todayRepayments ?? 0, { minor: false })}<span>{stats?.todayRepaymentsCount ?? 0}</span></dd>
          </div>
        </dl>
      </section>

      <div className="ag-tx-filters">
        <div className="ag-chips ag-tx-chips" role="group" aria-label="Type">
          {FILTERS.map(f => (
            <button key={f.v || 'all'} type="button" className="ag-chip" aria-pressed={type === f.v} onClick={() => { setType(f.v); setPage(1) }}>{f.l}</button>
          ))}
        </div>
        <DatePicker ariaLabel="Show one day" sheetTitle="Show one day" allowEmpty maxIso={isoDate(today())}
          value={date} onChange={iso => { setDate(iso); setPage(1) }}
          renderTrigger={({ id, open, expanded, hasValue }) => (
            <button type="button" id={id} className={`ag-date-chip${hasValue ? ' is-set' : ''}`} aria-haspopup="dialog" aria-expanded={expanded} aria-label="Show one day" onClick={open}>
              <Icons.calendar size={18} aria-hidden="true" />
              <span>{date ? new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Any date'}</span>
            </button>
          )} />
        {date && (
          <button type="button" className="ui-icon-btn ui-icon-btn--soft ag-date-clear" aria-label="Clear date" onClick={() => { setDate(''); setPage(1) }}>
            <Icons.close size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {loading && transactions.length === 0 ? (
        <ListSkeleton count={8} />
      ) : failed && transactions.length === 0 ? (
        <section className="ui-card">
          <EmptyState icon="error" tone="danger" title="Couldn’t load transactions" text="Check your connection and try again."
            action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
        </section>
      ) : transactions.length === 0 ? (
        <section className="ui-card">
          {filtered
            ? <EmptyState icon="history" title="Nothing here" text="No transactions match these filters."
                action={<button type="button" className="ui-btn ui-btn--secondary" onClick={() => { setType(''); setDate(''); setPage(1) }}>Clear filters</button>} />
            : <EmptyState icon="history" title="No transactions yet" text="Savings, collections and loans you handle will show here." />}
        </section>
      ) : (
        <div className={`ag-tx-list${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          {sections.map(sec => (
            <section key={sec.label} aria-label={sec.label}>
              <h2 className="ui-date-head">{sec.label}</h2>
              <div className="ui-card ui-card--list">
                {sec.items.map(t => {
                  const m = meta(t.type)
                  const Icon = Icons[m.icon]
                  const done = t.status === 'Done'
                  const who = t.customer ? displayName(t.customer.name) : m.label
                  return (
                    <Link key={t.id} href={`/dashboard/transactions/${t.id}`} className="ui-row ui-row--button">
                      <span className={`ui-row-icon ag-tx-icon ag-tx-icon--${m.sign === '+' ? 'in' : m.sign === '−' ? 'out' : 'neutral'}`} aria-hidden="true"><Icon size={20} /></span>
                      <span className="ui-row-main">
                        <span className="ui-row-title ui-block">{who}</span>
                        <span className="ui-row-sub ui-block">{t.customer ? `${m.label} · ` : ''}{formatTime(t.createdAt)}{t.method ? ` · ${t.method}` : ''}</span>
                      </span>
                      <span className="ui-value-stack ag-txn-value">
                        <span className={m.sign === '+' ? 'ui-amount--positive' : undefined}>
                          {t.type === 'enrolment' ? 'New' : `${m.sign}${formatNaira(t.amount, { minor: false })}`}
                        </span>
                        {!done && <span className={`ui-status ui-status--sm ${t.status === 'Failed' || t.status === 'Rejected' ? 'ui-status--danger' : 'ui-status--warn'}`}>{t.status}</span>}
                      </span>
                      <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="ag-pager ag-pager--page" aria-label="Pages">
          <button type="button" className="ui-btn ui-btn--secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
            <Icons.back size={18} aria-hidden="true" /> Newer
          </button>
          <span className="ui-row-sub">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <button type="button" className="ui-btn ui-btn--secondary" disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>
            Older <Icons.next size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  )
}
