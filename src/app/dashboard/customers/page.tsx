'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons, type IconName } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira, formatTime } from '@/lib/format'

interface Plan {
  id: string; goal: string; status: string; balance: number; dailyAmount: number
  periodDays: number; cadence?: string; maturityDate: string; startDate?: string
}

interface Customer {
  id: string
  customerId: string
  firstName: string
  lastName: string
  phone: string
  email?: string
  address: string
  status: string
  savingsBalance: number
  planDays: number | null
  planId: string | null
  activeLoan: { ref: string; totalAmount: number; status: string } | null
  nokName: string
  nokRelation: string
  nokPhone: string
  language: string
  createdAt: string
  savingsPlans: Plan[]
  photoUrl?: string | null
}

interface MonthStats { saved: number; missed: number; pct: number; bestStreak: number }

interface Txn { id: string; type: string; method: string | null; amount: number; status: string; createdAt: string; planId: string | null }

const TXN: Record<string, { label: string; icon: IconName; sign: '+' | '−' }> = {
  saving: { label: 'Saving', icon: 'deposit', sign: '+' },
  redemption: { label: 'Collection', icon: 'withdraw', sign: '−' },
  repayment: { label: 'Loan repayment', icon: 'repay', sign: '−' },
}
const txnMeta = (type: string) => TXN[type] ?? { label: type.charAt(0).toUpperCase() + type.slice(1), icon: 'history' as IconName, sign: '−' as const }

const STATUSES = ['', 'Active', 'Inactive', 'Flagged'] as const
type StatusFilter = typeof STATUSES[number]

const fullName = (c: Pick<Customer, 'firstName' | 'lastName'>) => displayName(`${c.firstName} ${c.lastName}`)
const initials = (c: Pick<Customer, 'firstName' | 'lastName'>) => `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase()


function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

/** Progress of a plan towards its target (agreed amount × length). */
function planProgress(p: Plan) {
  const target = p.dailyAmount * p.periodDays
  return target > 0 ? Math.min(100, Math.round((p.balance / target) * 100)) : 0
}

function mainPlan(c: Customer) {
  const active = c.savingsPlans.filter(p => p.status === 'Active')
  return { plan: [...active].sort((a, b) => b.balance - a.balance)[0] ?? null, others: Math.max(0, active.length - 1) }
}

function Avatar({ c, size }: { c: Customer; size?: 'lg' }) {
  const cls = `ui-avatar ag-av ag-av--${avatarTint(c.customerId)}${size === 'lg' ? ' ag-av--lg' : ''}`
  return c.photoUrl
    ? <img src={c.photoUrl} alt="" className={cls} />
    : <span className={cls} aria-hidden="true">{initials(c)}</span>
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'Active') return null
  const tone = status === 'Flagged' ? 'danger' : 'neutral'
  return <span className={`ui-status ui-status--sm ui-status--${tone}`}>{status}</span>
}

function useWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Partial<Record<StatusFilter, number>>>({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [plan, setPlan] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [custTxns, setCustTxns] = useState<Txn[]>([])
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const limit = 10
  const router = useRouter()
  const wide = useWide()
  const [habits, setHabits] = useState<Record<string, MonthStats>>({})

  // This month's saving habit per customer (days saved vs missed), from the savings calendar.
  useEffect(() => {
    fetch('/api/calendar')
      .then(r => r.json())
      .then(d => {
        const map: Record<string, MonthStats> = {}
        for (const c of (d.customers ?? []) as { customerId: string; plan: unknown; monthStats?: MonthStats }[]) {
          if (c.plan && c.monthStats) map[c.customerId] = c.monthStats
        }
        setHabits(map)
      })
      .catch(() => {})
  }, [])

  async function generateInvite() {
    setInviteLoading(true); setInviteError('')
    try {
      const res = await fetch('/api/agent/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.link) setInviteLink(data.link)
      else setInviteError(data.error ?? 'Couldn’t create an invite link. Please try again.')
    } catch {
      setInviteError('No connection. Check your internet and try again.')
    } finally { setInviteLoading(false) }
  }

  function copyInvite() {
    navigator.clipboard?.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  // Portfolio counts for the status chips (one small request per status, using the list endpoint's total).
  useEffect(() => {
    STATUSES.forEach(s => {
      fetch(`/api/customers?${new URLSearchParams({ status: s, limit: '1', page: '1' })}`)
        .then(r => r.json())
        .then(d => setCounts(c => ({ ...c, [s]: d.total ?? 0 })))
        .catch(() => {})
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      search, status, plan, page: String(page), limit: String(limit),
    })
    try {
      const res = await fetch(`/api/customers?${params}`)
      const data = await res.json()
      setCustomers(data.customers ?? [])
      setTotal(data.total ?? 0)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }, [search, status, plan, page])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [load])

  const totalPages = Math.ceil(total / limit)
  const filtered = !!(search || status || plan)

  const viewCustomer = useCallback(async (c: Customer, openSheet: boolean) => {
    setSelected(c)
    setSheetOpen(openSheet)
    setExpandedPlan(null)
    setCustTxns([])
    setTxnsLoading(true)
    try {
      const res = await fetch(`/api/transactions?customerId=${c.id}&limit=100`)
      const data = await res.json()
      setCustTxns(data.transactions ?? [])
    } catch {
      setCustTxns([])
    } finally { setTxnsLoading(false) }
  }, [])

  // On a wide screen the details panel is always visible, so start with the first customer in it.
  useEffect(() => {
    if (!wide || loading || customers.length === 0) return
    if (!selected || !customers.some(c => c.id === selected.id)) viewCustomer(customers[0], false)
  }, [wide, loading, customers, selected, viewCustomer])

  function go(path: string) {
    if (!selected) return
    const cid = selected.customerId
    setSheetOpen(false)
    router.push(`${path}?cid=${cid}`)
  }

  const detail = selected && (
    <CustomerDetail
      c={selected}
      txns={custTxns}
      txnsLoading={txnsLoading}
      expandedPlan={expandedPlan}
      setExpandedPlan={setExpandedPlan}
      go={go}
      habit={habits[selected.customerId]}
    />
  )

  return (
    <div className="ag-page">
      <section className="ag-hello">
        <div>
          <p className="ag-count">{counts[''] !== undefined ? `${counts['']} customer${counts[''] === 1 ? '' : 's'} in your portfolio` : 'Everyone you’ve enrolled'}</p>
        </div>
        <div className="ag-head-actions">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={generateInvite} disabled={inviteLoading}>
            {inviteLoading ? <span className="ui-spinner ui-spinner--sm ag-spin-dark" aria-hidden="true" /> : <Icons.share size={18} aria-hidden="true" />} Invite
          </button>
          <Link href="/dashboard/enrol" className="ui-btn ui-btn--primary"><Icons.add size={18} aria-hidden="true" /> Enrol customer</Link>
        </div>
      </section>

      {inviteError && (
        <div className="ui-banner ui-banner--danger" role="alert"><Icons.error size={18} aria-hidden="true" /><div>{inviteError}</div></div>
      )}
      {inviteLink && (
        <section className="ui-card ag-invite" aria-label="Invite link">
          <div className="ag-invite-head">
            <div>
              <p className="ui-row-title">Invite link</p>
              <p className="ui-row-sub">Send it to the customer. It works once.</p>
            </div>
            <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setInviteLink('')} aria-label="Close invite link">
              <Icons.close size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="ag-invite-row">
            <input readOnly className="ui-input ag-invite-input" value={inviteLink} aria-label="Invite link" onFocus={e => e.target.select()} />
            <button type="button" className="ui-btn ui-btn--primary" onClick={copyInvite}>
              {inviteCopied ? <><Icons.check size={18} aria-hidden="true" /> Copied</> : 'Copy'}
            </button>
          </div>
        </section>
      )}

      <div className="ag-cust">
        <div className="ag-cust-list">
          <div className="ag-toolbar">
            <div className="ag-search">
              <Icons.search size={20} aria-hidden="true" />
              <input
                className="ui-input"
                type="search"
                enterKeyHint="search"
                placeholder="Name, phone or customer ID"
                aria-label="Search customers"
                autoComplete="off"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
              />
            </div>
            <select className="ui-input ui-select ag-plan-filter" aria-label="Plan length" value={plan} onChange={e => { setPlan(e.target.value); setPage(1) }}>
              <option value="">All plan lengths</option>
              <option value="30">30 days</option><option value="60">60 days</option>
              <option value="90">90 days</option><option value="180">180 days</option>
            </select>
          </div>

          <div className="ag-chips" role="group" aria-label="Status">
            {STATUSES.map(s => (
              <button key={s || 'all'} type="button" className="ag-chip" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1) }}>
                {s || 'All'}
                {counts[s] !== undefined && <span className="ag-chip-count">{counts[s]}</span>}
              </button>
            ))}
          </div>

          {loading && customers.length === 0 ? (
            <ListSkeleton count={6} />
          ) : failed && customers.length === 0 ? (
            <section className="ui-card">
              <EmptyState icon="error" tone="danger" title="Couldn’t load customers" text="Check your connection and try again."
                action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
            </section>
          ) : customers.length === 0 ? (
            <section className="ui-card">
              {filtered
                ? <EmptyState icon="search" title="No customers match" text="Try another name, phone number or filter." />
                : <EmptyState icon="customers" title="No customers yet" text="Customers you enrol will show here."
                    action={<Link href="/dashboard/enrol" className="ui-btn ui-btn--primary">Enrol a customer</Link>} />}
            </section>
          ) : (
            <section className={`ui-card ui-card--list ag-list${loading ? ' is-loading' : ''}`} aria-busy={loading} aria-label="Customers">
              {customers.map(c => {
                const { plan: main, others } = mainPlan(c)
                const pct = main ? planProgress(main) : 0
                const left = main ? daysLeft(main.maturityDate) : 0
                const isSel = wide && selected?.id === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`ag-crow${isSel ? ' is-selected' : ''}`}
                    aria-current={isSel ? 'true' : undefined}
                    onClick={() => viewCustomer(c, !wide)}
                  >
                    <Avatar c={c} />
                    <span className="ag-crow-main">
                      <span className="ag-crow-name">{fullName(c)} <StatusBadge status={c.status} /></span>
                      <span className="ag-crow-sub">{c.customerId} · {c.phone}</span>
                      {main ? (
                        <span className="ag-crow-plan">
                          <span className="ag-mini-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                          <span className="ag-crow-plan-text">{main.goal} · {pct}%{others > 0 ? ` · +${others} more` : ''}</span>
                          {habits[c.customerId] && isDaily(main) && <HabitDot h={habits[c.customerId]} />}
                        </span>
                      ) : (
                        <span className="ag-crow-plan ag-crow-plan--none">No active plan</span>
                      )}
                    </span>
                    <span className="ag-crow-end">
                      <span className="ag-crow-bal">{formatNaira(c.savingsBalance, { minor: false })}</span>
                      {c.activeLoan
                        ? <span className="ag-crow-tag ag-crow-tag--loan">Loan {formatNaira(c.activeLoan.totalAmount, { minor: false })}</span>
                        : main && <span className={`ag-crow-tag${left <= 7 ? ' ag-crow-tag--soon' : ''}`}>{left <= 0 ? 'Ends today' : `Ends in ${left} day${left === 1 ? '' : 's'}`}</span>}
                    </span>
                  </button>
                )
              })}
            </section>
          )}

          {totalPages > 1 && (
            <nav className="ag-pager ag-pager--page" aria-label="Pages">
              <button type="button" className="ui-btn ui-btn--secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <Icons.back size={18} aria-hidden="true" /> Previous
              </button>
              <span className="ui-row-sub">Page {page} of {totalPages}</span>
              <button type="button" className="ui-btn ui-btn--secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <Icons.next size={18} aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>

        {wide && (
          <aside className="ui-card ag-cust-panel" aria-label="Customer details">
            {detail ?? <EmptyState icon="customers" title="Choose a customer" text="Their plans, balance and history show here." />}
          </aside>
        )}
      </div>

      {!wide && (
        <BottomSheet open={sheetOpen && !!selected} onClose={() => setSheetOpen(false)} title="Customer">
          {detail}
        </BottomSheet>
      )}
    </div>
  )
}

/** The calendar counts days, so its habit figures only make sense for daily savers. */
function isDaily(p: Plan | null) {
  return !!p && (p.cadence ?? 'daily') === 'daily'
}

function habitTone(pct: number) {
  return pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'low'
}

/** Small "86% this month" marker on a customer row. */
function HabitDot({ h }: { h: MonthStats }) {
  const days = h.saved + h.missed
  if (days === 0) return null
  return (
    <span className={`ag-habit ag-habit--${habitTone(h.pct)}`} title={`Saved on ${h.saved} of ${days} days this month`}>
      {h.pct}% this month
    </span>
  )
}

function CustomerDetail({ c, txns, txnsLoading, expandedPlan, setExpandedPlan, go, habit }: {
  c: Customer
  txns: Txn[]
  txnsLoading: boolean
  expandedPlan: string | null
  setExpandedPlan: (id: string | null) => void
  go: (path: string) => void
  habit?: MonthStats
}) {
  const active = c.savingsPlans.filter(p => p.status === 'Active').length
  return (
    <div className="ag-profile">
      <div className="ag-profile-head">
        <Avatar c={c} size="lg" />
        <div className="ag-profile-main">
          <p className="ag-profile-name">{fullName(c)} <StatusBadge status={c.status} /></p>
          <p className="ui-row-sub">{c.customerId} · since {formatDate(c.createdAt)}</p>
          <a className="ui-link ag-profile-phone" href={`tel:${c.phone}`}><Icons.phone size={16} aria-hidden="true" /> {c.phone}</a>
        </div>
      </div>

      {habit && habit.saved + habit.missed > 0 && isDaily(mainPlan(c).plan) && (
        <div className={`ag-habit-card ag-habit-card--${habitTone(habit.pct)}`}>
          <div className="ag-habit-ring" style={{ ['--pct' as string]: `${habit.pct}` }} aria-hidden="true"><span>{habit.pct}%</span></div>
          <div>
            <p className="ui-row-title">Saved on {habit.saved} of {habit.saved + habit.missed} days this month</p>
            <p className="ui-row-sub">
              {habit.pct >= 80 ? 'Saving steadily.' : habit.pct >= 50 ? 'Missing some days.' : 'Missing most days. Worth a call.'}
              {habit.bestStreak > 1 ? ` Best run: ${habit.bestStreak} days in a row.` : ''}
            </p>
          </div>
        </div>
      )}

      <dl className="ag-profile-stats">
        <div><dt>Total saved</dt><dd>{formatNaira(c.savingsBalance)}</dd></div>
        <div><dt>Active plans</dt><dd>{active}</dd></div>
        <div><dt>Loan</dt><dd className={c.activeLoan ? 'ag-loan-text' : undefined}>{c.activeLoan ? formatNaira(c.activeLoan.totalAmount, { minor: false }) : 'None'}</dd></div>
      </dl>

      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => go('/dashboard/savings')}>
        <Icons.plan size={18} aria-hidden="true" /> Record saving
      </button>
      <div className="ag-profile-actions">
        <button type="button" className="ui-btn ui-btn--secondary" onClick={() => go('/dashboard/add-plan')}><Icons.add size={18} aria-hidden="true" /> Add plan</button>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={() => go('/dashboard/loan-request')}><Icons.loan size={18} aria-hidden="true" /> Loan</button>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={() => go('/dashboard/loan-repay')}><Icons.repay size={18} aria-hidden="true" /> Repay</button>
      </div>

      <h3 className="ag-profile-section">Savings plans</h3>
      {c.savingsPlans.length === 0 ? (
        <p className="ui-note">No savings plans yet.</p>
      ) : c.savingsPlans.map(p => {
        const planTxns = txns.filter(t => t.planId === p.id)
        const isOpen = expandedPlan === p.id
        const weekly = p.cadence === 'weekly'
        const pct = planProgress(p)
        const target = p.dailyAmount * p.periodDays
        const left = daysLeft(p.maturityDate)
        const isActive = p.status === 'Active'
        return (
          <div key={p.id} className={`ag-plan${isActive ? '' : ' ag-plan--past'}`}>
            <div className="ag-plan-top">
              <span className="ui-row-title">{p.goal}</span>
              <span className={`ui-status ui-status--sm ${isActive ? 'ui-status--success' : 'ui-status--neutral'}`}>{p.status}</span>
            </div>
            <div className="ag-plan-figures">
              <span className="ag-plan-balance">{formatNaira(p.balance, { minor: false })}</span>
              <span className="ui-row-sub">of {formatNaira(target, { minor: false })}</span>
            </div>
            <div className="ui-progress ag-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${p.goal}: ${pct}% saved`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="ag-plan-meta">
              <span>{formatNaira(weekly ? p.dailyAmount * 7 : p.dailyAmount, { minor: false })} {weekly ? 'a week' : 'a day'}</span>
              <span>{isActive ? (left <= 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left · ${formatDate(p.maturityDate)}`) : `Ended ${formatDate(p.maturityDate)}`}</span>
            </p>
            <button
              type="button"
              className="ag-plan-toggle"
              onClick={() => setExpandedPlan(isOpen ? null : p.id)}
              aria-expanded={isOpen}
              disabled={txnsLoading}
            >
              <span>{txnsLoading ? 'Loading transactions…' : `${planTxns.length} transaction${planTxns.length === 1 ? '' : 's'}`}</span>
              {!txnsLoading && <Icons.expand size={18} aria-hidden="true" className={isOpen ? 'is-open' : undefined} />}
            </button>
            {isOpen && (
              planTxns.length === 0
                ? <p className="ui-note ui-note--center">No transactions yet</p>
                : <div className="ag-plan-txns">
                    {planTxns.map(t => {
                      const m = txnMeta(t.type)
                      return (
                        <ListRow
                          key={t.id}
                          icon={m.icon}
                          title={<>{m.label}{t.method ? <span className="ui-row-sub"> · {t.method}</span> : null}</>}
                          sub={`${formatDate(t.createdAt)} · ${formatTime(t.createdAt)}`}
                          value={
                            <span className="ui-value-stack ag-txn-value">
                              <span className={m.sign === '+' ? 'ui-amount--positive' : undefined}>{m.sign}{formatNaira(t.amount, { minor: false })}</span>
                              {t.status !== 'Done' && <span className="ui-status ui-status--warn ui-status--sm">{t.status}</span>}
                            </span>
                          }
                        />
                      )
                    })}
                  </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
