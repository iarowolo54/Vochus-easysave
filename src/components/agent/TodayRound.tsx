'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'
import { Bone } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatNaira, formatTime } from '@/lib/format'

type Plan = { status: string; cadence?: string; dailyAmount: number; startDate?: string; maturityDate: string }
type Customer = { id: string; customerId: string; firstName: string; lastName: string; phone: string; photoUrl?: string | null; savingsPlans: Plan[] }
type Saving = { createdAt: string; customer?: { customerId?: string } }

type Due = { code: string; name: string; phone: string; amount: number; photoUrl?: string | null; paidAt?: string }

const SHOW = 6

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** All pages of an agent list endpoint (customers / savings). */
async function fetchAll<T>(url: (page: number) => string, key: string, stop?: (items: T[]) => boolean): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= 20; page++) {
    const d = await fetch(url(page)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    const items: T[] = d[key] ?? []
    out.push(...items)
    const total: number | undefined = d.total
    if (items.length === 0 || (total !== undefined && out.length >= total) || stop?.(items)) break
  }
  return out
}

/**
 * Today's round: daily savers with an active plan, who has paid today and who hasn't yet.
 * Built only from the existing customers and transactions lists.
 */
export default function TodayRound() {
  const [due, setDue] = useState<Due[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  async function load() {
    setFailed(false)
    try {
      const now = new Date()
      const [customers, savings] = await Promise.all([
        fetchAll<Customer>(p => `/api/customers?limit=100&page=${p}`, 'customers'),
        // Newest first: stop paging once a page reaches yesterday.
        fetchAll<Saving>(p => `/api/transactions?type=saving&limit=50&page=${p}`, 'transactions',
          items => !sameDay(new Date(items[items.length - 1].createdAt), now)),
      ])
      const paid = new Map<string, string>()
      for (const s of savings) {
        const code = s.customer?.customerId
        if (code && sameDay(new Date(s.createdAt), now) && !paid.has(code)) paid.set(code, s.createdAt)
      }
      const list: Due[] = []
      for (const c of customers) {
        const plan = c.savingsPlans.find(p =>
          p.status === 'Active' && (p.cadence ?? 'daily') === 'daily'
          && (!p.startDate || new Date(p.startDate) <= now) && new Date(p.maturityDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        if (!plan) continue
        list.push({
          code: c.customerId, name: displayName(`${c.firstName} ${c.lastName}`), phone: c.phone,
          amount: plan.dailyAmount, photoUrl: c.photoUrl, paidAt: paid.get(c.customerId),
        })
      }
      // Unpaid first (alphabetical, so the order is stable through the day), then paid by time.
      list.sort((a, b) => (a.paidAt ? 1 : 0) - (b.paidAt ? 1 : 0) || (a.paidAt && b.paidAt ? b.paidAt.localeCompare(a.paidAt) : a.name.localeCompare(b.name)))
      setDue(list)
    } catch {
      setFailed(true)
    }
  }

  useEffect(() => { load() }, [])

  if (failed) {
    return (
      <section className="ui-card ag-round" aria-label="Today’s round">
        <EmptyState icon="error" tone="danger" title="Couldn’t load today’s round" text="Check your connection and try again."
          action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
      </section>
    )
  }

  if (due === null) {
    return (
      <section className="ui-card ag-round ui-skeleton" aria-hidden="true">
        <Bone w="40%" h={22} /><div style={{ height: 12 }} /><Bone h={8} /><div style={{ height: 16 }} />
        <div className="ag-round-grid">{Array.from({ length: 3 }, (_, i) => <Bone key={i} h={64} />)}</div>
      </section>
    )
  }

  const paidCount = due.filter(d => d.paidAt).length
  const toGo = due.filter(d => !d.paidAt)
  const expected = toGo.reduce((s, d) => s + d.amount, 0)
  const pct = due.length ? Math.round((paidCount / due.length) * 100) : 0
  const shown = showAll ? due : toGo.slice(0, SHOW)

  return (
    <section className="ui-card ag-round" aria-labelledby="round-title">
      <div className="ag-round-head">
        <div>
          <h2 id="round-title" className="ui-card-title">Today’s round</h2>
          <p className="ui-row-sub">
            {due.length === 0 ? 'No daily savers with an active plan'
              : toGo.length === 0 ? 'Everyone has paid today'
              : <><strong className="ag-round-strong">{toGo.length} to visit</strong> · {formatNaira(expected, { minor: false })} still to collect</>}
          </p>
        </div>
        {due.length > 0 && <span className="ag-round-count"><strong>{paidCount}</strong> of {due.length} paid</span>}
      </div>
      {due.length > 0 && (
        <div className="ui-progress ag-round-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${paidCount} of ${due.length} paid today`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      {due.length > 0 && toGo.length === 0 && !showAll && (
        <div className="ag-round-done"><Icons.check size={20} aria-hidden="true" /> All {due.length} daily savers have paid. Nice work.</div>
      )}

      {shown.length > 0 && (
        <ul className="ag-round-grid">
          {shown.map(d => (
            <li key={d.code} className={`ag-round-item${d.paidAt ? ' is-paid' : ''}`}>
              {d.photoUrl
                ? <img src={d.photoUrl} className={`ui-avatar ag-av ag-av--${avatarTint(d.code)}`} alt="" />
                : <span className={`ui-avatar ag-av ag-av--${avatarTint(d.code)}`} aria-hidden="true">{d.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>}
              <span className="ag-round-main">
                <span className="ag-round-name">{d.name}</span>
                <span className="ag-round-sub">{d.paidAt ? `Paid at ${formatTime(d.paidAt)}` : `${formatNaira(d.amount, { minor: false })} a day`}</span>
              </span>
              {d.paidAt ? (
                <span className="ag-round-tick" aria-label="Paid"><Icons.check size={18} aria-hidden="true" /></span>
              ) : (
                <span className="ag-round-actions">
                  <a href={`tel:${d.phone}`} className="ui-icon-btn ui-icon-btn--soft ag-round-call" aria-label={`Call ${d.name}`}><Icons.phone size={18} aria-hidden="true" /></a>
                  <Link href={`/dashboard/savings?cid=${encodeURIComponent(d.code)}`} className="ui-btn ui-btn--primary ag-round-record" aria-label={`Record saving for ${d.name}`}>Record</Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {due.length > SHOW || (paidCount > 0 && toGo.length <= SHOW) ? (
        <button type="button" className="ui-link ag-round-more" onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show who’s left' : `Show everyone (${due.length})`}
          <Icons.expand size={16} aria-hidden="true" className={showAll ? 'is-open' : undefined} />
        </button>
      ) : null}
    </section>
  )
}
