'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useWide } from '@/components/ui/useWide'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatNaira } from '@/lib/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CustomerTile {
  id: string
  customerId: string
  name: string
  phone: string
  planCount: number
  plan: { dailyAmount: number; periodDays: number; startDate: string; maturityDate: string; balance: number } | null
  monthStats: { saved: number; missed: number; total: number; pct: number; bestStreak: number }
}

interface DayData { amount: number; ref: string; time: string }
interface CalCustomer { id: string; customerId: string; name: string; phone: string }
interface CalPlan { id: string; goal?: string; dailyAmount: number; periodDays: number; cadence?: string | null; startDate: string; maturityDate: string; balance: number }

/** ₦500 → "500", ₦12,500 → "12.5k": fits inside a calendar day. */
function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(Math.round(n))
}
function tone(pct: number) {
  return pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'low'
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}


function CalendarPage() {
  const searchParams = useSearchParams()
  const wide = useWide()

  const today = new Date()
  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<CustomerTile[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listFailed, setListFailed] = useState(false)

  const [selected, setSelected] = useState<CalCustomer | null>(null)
  const [plans, setPlans] = useState<CalPlan[]>([])
  const [planId, setPlanId] = useState<string | null>(null)
  const [daysByPlan, setDaysByPlan] = useState<Record<string, Record<number, DayData>>>({})
  const [loadingCal, setLoadingCal] = useState(false)
  const [activeDay, setActiveDay] = useState<number | null>(null)
  const [showLog, setShowLog] = useState(false)

  const cidParam = searchParams.get('cid')

  const loadCalendar = useCallback((cid: string, yr: number, mo: number) => {
    setLoadingCal(true)
    setActiveDay(null)
    fetch(`/api/calendar?year=${yr}&month=${mo}&customerId=${cid}`)
      .then(r => r.json())
      .then(d => {
        setPlans(d.plans ?? [])
        setDaysByPlan(d.daysByPlan ?? {})
      })
      .catch(() => {})
      .finally(() => setLoadingCal(false))
  }, [])

  const selectCustomer = useCallback((c: CustomerTile) => {
    const now = new Date()
    setSelected({ id: c.id, customerId: c.customerId, name: c.name, phone: c.phone })
    setPlans(c.plan ? [c.plan as CalPlan] : [])
    setPlanId(null)
    setDaysByPlan({})
    setCalYear(now.getFullYear())
    setCalMonth(now.getMonth())
    loadCalendar(c.id, now.getFullYear(), now.getMonth())
    window.scrollTo({ top: 0 })
  }, [loadCalendar])

  useEffect(() => {
    const now = new Date()
    fetch(`/api/calendar?year=${now.getFullYear()}&month=${now.getMonth()}`)
      .then(r => r.json())
      .then(d => {
        const list: CustomerTile[] = d.customers ?? []
        setCustomers(list)
        setListFailed(false)
        if (cidParam) {
          const match = list.find(c => c.customerId === cidParam)
          if (match) selectCustomer(match)
        }
      })
      .catch(() => setListFailed(true))
      .finally(() => setLoadingList(false))
  }, [cidParam, selectCustomer])

  function clearCustomer() {
    setSelected(null); setPlans([]); setPlanId(null); setDaysByPlan({}); setSearch(''); setActiveDay(null)
  }

  function moveMonth(delta: number) {
    let y = calYear, m = calMonth + delta
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setCalYear(y); setCalMonth(m)
    if (selected) loadCalendar(selected.id, y, m)
  }

  function goToday() {
    setCalYear(today.getFullYear()); setCalMonth(today.getMonth())
    if (selected) loadCalendar(selected.id, today.getFullYear(), today.getMonth())
  }

  // A customer can have several active plans; each has its own calendar.
  const plan = plans.find(p => p.id === planId) ?? plans[0] ?? null
  const days: Record<number, DayData> = (plan && daysByPlan[plan.id]) || {}

  const dim = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const isCurMo = calYear === today.getFullYear() && calMonth === today.getMonth()
  const isFutureMonth = calYear > today.getFullYear() || (calYear === today.getFullYear() && calMonth > today.getMonth())
  const maxDay = isFutureMonth ? 0 : isCurMo ? today.getDate() : dim
  const planStart = plan?.startDate ? new Date(plan.startDate) : null
  const startKey = planStart ? new Date(planStart.getFullYear(), planStart.getMonth(), planStart.getDate()).getTime() : null
  const beforePlan = (d: number) => startKey !== null && new Date(calYear, calMonth, d).getTime() < startKey
  // From the plan's end date on, a day can't be saved for, so it is neither missed nor offered as a late saving.
  const planEnd = plan?.maturityDate ? new Date(plan.maturityDate) : null
  const endKey = planEnd ? new Date(planEnd.getFullYear(), planEnd.getMonth(), planEnd.getDate()).getTime() : null
  const afterPlan = (d: number) => endKey !== null && new Date(calYear, calMonth, d).getTime() >= endKey
  /** Flexible plans have no set days, so a day without a saving isn't a missed day. */
  const flexCal = plan?.cadence === 'flexible'
  const planRate = (p: { dailyAmount: number; cadence?: string | null }) => p.cadence === 'flexible' ? 'flexible' : `${formatNaira(p.dailyAmount, { minor: false })} a day`

  let savedCount = 0, missedCount = 0, totalSaved = 0, bestStreak = 0, cur = 0
  for (let d = 1; d <= maxDay; d++) {
    const v = days[d]?.amount ?? 0
    if (v <= 0 && (beforePlan(d) || afterPlan(d))) continue
    if (v > 0) { savedCount++; totalSaved += v; cur++; bestStreak = Math.max(bestStreak, cur) }
    else if (!flexCal && !(isCurMo && d === today.getDate())) { missedCount++; cur = 0 }
  }
  const counted = savedCount + missedCount
  const pct = counted > 0 ? Math.round(savedCount / counted * 100) : 0
  const monthTarget = (plan?.dailyAmount ?? 0) * dim
  const progPct = monthTarget > 0 ? Math.min(100, Math.round(totalSaved / monthTarget * 100)) : 0

  const running: Record<number, number> = {}
  let rt = 0
  for (let d = 1; d <= maxDay; d++) { rt += days[d]?.amount ?? 0; running[d] = rt }

  const q = search.trim().toLowerCase()
  const filtered = customers.filter(c => !q || c.name.toLowerCase().includes(q) || c.customerId.toLowerCase().includes(q) || c.phone.includes(q))

  const lateLink = (d: number) => `/dashboard/savings?cid=${encodeURIComponent(selected?.customerId ?? '')}&date=${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  // ── Customer list ──
  if (!selected) {
    return (
      <div className="ag-page">
        <p className="ag-count ag-cal-intro">Pick a customer to see which days they saved and which they missed.</p>
        <div className="ag-search ag-cal-search">
          <Icons.search size={20} aria-hidden="true" />
          <input className="ui-input" type="search" placeholder="Name, phone or customer ID" aria-label="Search customers" autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loadingList ? (
          <ListSkeleton count={6} />
        ) : listFailed ? (
          <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load customers" text="Check your connection and refresh the page." /></section>
        ) : filtered.length === 0 ? (
          <section className="ui-card"><EmptyState icon="customers" title={q ? 'No customers match' : 'No customers yet'} text={q ? 'Try another name, phone number or ID.' : 'Customers you enrol will show here.'} /></section>
        ) : (
          <section className="ui-card ui-card--list ag-list" aria-label="Customers">
            {filtered.map(c => {
              const { pct: p, total, saved, missed } = c.monthStats
              return (
                <button key={c.id} type="button" className="ag-crow" onClick={() => selectCustomer(c)}>
                  <span className={`ui-avatar ag-av ag-av--${avatarTint(c.customerId)}`} aria-hidden="true">{initials(c.name)}</span>
                  <span className="ag-crow-main">
                    <span className="ag-crow-name">{displayName(c.name)}</span>
                    <span className="ag-crow-sub">{c.customerId} · {c.plan ? `${formatNaira(c.plan.dailyAmount, { minor: false })} a day${c.planCount > 1 ? ` · ${c.planCount} plans` : ''}` : 'No active plan'}</span>
                    {c.plan && saved + missed > 0 && (
                      <span className="ag-crow-plan">
                        <span className={`ag-mini-bar ag-mini-bar--${tone(p)}`} aria-hidden="true"><span style={{ width: `${p}%` }} /></span>
                        <span className="ag-crow-plan-text">Saved {saved} of {saved + missed} days</span>
                      </span>
                    )}
                  </span>
                  <span className="ag-crow-end">
                    {c.plan && saved + missed > 0 && <span className={`ag-habit ag-habit--${tone(p)} ag-habit--lg`}>{p}%</span>}
                    <span className="ui-row-sub">{formatNaira(total, { minor: false })} this month</span>
                  </span>
                </button>
              )
            })}
          </section>
        )}
      </div>
    )
  }

  // ── One customer's month ──
  const dayDetail = activeDay !== null && (() => {
    const v = days[activeDay]?.amount ?? 0
    const isToday = isCurMo && activeDay === today.getDate()
    const label = new Date(calYear, calMonth, activeDay).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    const target = plan?.dailyAmount ?? 0
    return (
      <div className="ag-day">
        <p className="ag-day-date">{label}</p>
        {v > 0 ? (
          <>
            <p className="ag-day-amount">{formatNaira(v)}</p>
            <span className="ui-status ui-status--success"><Icons.check size={14} aria-hidden="true" /> Saved</span>
            {beforePlan(activeDay) && <p className="ui-row-sub ag-day-note">Saved into an earlier plan, before the current one started.</p>}
            <dl className="ag-breakdown">
              {!beforePlan(activeDay) && target > 0 && <>
                <div><dt>Daily amount</dt><dd>{formatNaira(target, { minor: false })}</dd></div>
                <div><dt>Compared with it</dt><dd className={v >= target ? 'ag-pos' : 'ag-warn-text'}>
                  {v === target ? 'Exactly' : v > target ? `${Math.round((v / target - 1) * 100)}% more` : `${Math.round((1 - v / target) * 100)}% less`}
                </dd></div>
              </>}
              <div><dt>Saved so far this month</dt><dd>{formatNaira(running[activeDay] ?? 0, { minor: false })}</dd></div>
              <div><dt>Time</dt><dd>{days[activeDay]?.time ?? '—'}</dd></div>
              <div><dt>Reference</dt><dd className="ag-mono">{days[activeDay]?.ref ?? '—'}</dd></div>
            </dl>
          </>
        ) : (
          <>
            <p className="ag-day-amount ag-day-amount--none">{isToday ? 'Not yet today' : 'Missed'}</p>
            <p className="ui-row-sub">{isToday ? `${displayName(selected.name)} hasn’t saved yet today.` : `No saving was recorded for ${displayName(selected.name)} on this day.`}</p>
            <Link href={isToday ? `/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}` : lateLink(activeDay)} className="ui-btn ui-btn--primary ui-btn--block ag-day-btn">
              <Icons.add size={18} aria-hidden="true" /> {isToday ? 'Record today’s saving' : 'Record a late saving for this day'}
            </Link>
          </>
        )}
      </div>
    )
  })()

  return (
    <div className="ag-page">
      <section className="ag-cal-head">
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={clearCustomer} aria-label="Back to customers"><Icons.back size={20} aria-hidden="true" /></button>
        <span className={`ui-avatar ag-av ag-av--${avatarTint(selected.customerId)}`} aria-hidden="true">{initials(selected.name)}</span>
        <div className="ag-payee-main">
          <p className="ui-row-title">{displayName(selected.name)}</p>
          <p className="ui-row-sub">{selected.customerId}{plan ? ` · ${planRate(plan)} · ${plan.periodDays}-day plan` : ' · No active plan'}</p>
        </div>
        <Link href={`/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}`} className="ui-btn ui-btn--primary ag-cal-record">
          <Icons.add size={18} aria-hidden="true" /> Record saving
        </Link>
      </section>

      {plans.length > 1 && (
        <div className="ui-chips" role="group" aria-label="Savings plans">
          {plans.map(p => (
            <button key={p.id} type="button" className="ui-chip" aria-pressed={p.id === plan?.id}
              onClick={() => { setPlanId(p.id); setActiveDay(null) }}>
              {p.goal ? `${p.goal} · ` : ''}{planRate(p)}
            </button>
          ))}
        </div>
      )}

      {/* Only while the plan is still running: an ended plan can't be saved into (Roll over on Record saving restarts it). */}
      {plan && !flexCal && (endKey === null || endKey > Date.now()) && (
        <Link href={`/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}&bulk=1`}
          className="ui-btn ui-btn--secondary ui-btn--block ag-cal-catchup">
          <Icons.calendar size={18} aria-hidden="true" /> Catch up or pay ahead
        </Link>
      )}

      <div className="ag-cal-layout">
        <section className="ui-card ag-month" aria-label={`${MONTHS[calMonth]} ${calYear}`}>
          <div className="ag-month-nav">
            <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => moveMonth(-1)} aria-label="Previous month"><Icons.back size={20} aria-hidden="true" /></button>
            <h2 aria-live="polite">{MONTHS[calMonth]} {calYear}</h2>
            <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => moveMonth(1)} aria-label="Next month"><Icons.next size={20} aria-hidden="true" /></button>
            {!isCurMo && <button type="button" className="ui-link ag-month-today" onClick={goToday}>This month</button>}
          </div>

          <div className="ag-month-grid ag-month-dow" aria-hidden="true">{DOW.map(d => <span key={d}>{d}</span>)}</div>
          <div className={`ag-month-grid${loadingCal ? ' is-loading' : ''}`} aria-busy={loadingCal}>
            {Array.from({ length: firstDay }, (_, i) => <span key={`p${i}`} className="ag-cell ag-cell--pad" aria-hidden="true" />)}
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1
              const isToday = isCurMo && d === today.getDate()
              const isFuture = isFutureMonth || (isCurMo && d > today.getDate())
              const after = afterPlan(d)
              const before = beforePlan(d) || after
              const v = days[d]?.amount ?? 0
              // A day with money on it is always "saved", even before the current plan started (an earlier plan's saving).
              const state = v > 0 ? 'saved' : before ? 'before' : isFuture ? 'future' : isToday ? 'today' : flexCal ? 'none' : 'missed'
              const clickable = state !== 'future' && state !== 'before' && state !== 'none'
              const label = `${d} ${MONTHS[calMonth]}: ${state === 'saved' ? `saved ${formatNaira(v, { minor: false })}` : state === 'missed' ? 'missed' : state === 'today' ? 'today, not saved yet' : state === 'before' ? (after ? 'after the plan ended' : 'before the plan started') : state === 'none' ? 'no saving' : 'upcoming'}`
              return (
                <button key={d} type="button" className={`ag-cell ag-cell--${state}${isToday ? ' is-today' : ''}${activeDay === d ? ' is-active' : ''}`}
                  disabled={!clickable} aria-label={label} aria-pressed={activeDay === d} onClick={() => setActiveDay(d)}>
                  <span className="ag-cell-day">{d}</span>
                  {state === 'saved' && <span className="ag-cell-amt">{compact(v)}</span>}
                  {state === 'missed' && <span className="ag-cell-miss" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <ul className="ag-month-key">
            <li><span className="ag-key ag-key--saved" aria-hidden="true" /> Saved</li>
            <li><span className="ag-key ag-key--missed" aria-hidden="true" /> Missed</li>
            <li><span className="ag-key ag-key--today" aria-hidden="true" /> Today</li>
            {startKey !== null && <li><span className="ag-key ag-key--before" aria-hidden="true" /> Outside the plan</li>}
          </ul>
        </section>

        <aside className="ag-cal-side">
          <section className="ui-card ag-cal-summary" aria-label="This month">
            <div className={`ag-habit-card ag-habit-card--${tone(pct)}`}>
              <div className="ag-habit-ring" style={{ ['--pct' as string]: `${pct}` }} aria-hidden="true"><span>{pct}%</span></div>
              <div>
                <p className="ui-row-title">Saved on {savedCount} of {counted} days</p>
                <p className="ui-row-sub">{missedCount === 0 ? 'No missed days so far.' : `${missedCount} missed day${missedCount === 1 ? '' : 's'}.`}{bestStreak > 1 ? ` Best run: ${bestStreak} in a row.` : ''}</p>
              </div>
            </div>
            <div className="ag-cal-target">
              <div className="ag-cal-target-top">
                <span className="ui-row-sub">Saved this month</span>
                <span className="ag-cal-target-pct">{progPct}%</span>
              </div>
              <p className="ag-funded-value">{formatNaira(totalSaved, { minor: false })}</p>
              <div className="ui-progress"><span style={{ width: `${progPct}%` }} /></div>
              <p className="ui-row-sub">of {formatNaira(monthTarget, { minor: false })} for the whole month</p>
            </div>
          </section>

          {wide && (
            <section className="ui-card ag-day-panel" aria-label="Day details">
              {dayDetail || <EmptyState icon="calendar" title="Tap a day" text="See what was saved, or record a missed day." />}
            </section>
          )}
        </aside>
      </div>

      <section className="ag-log">
        <button type="button" className="ag-log-toggle" aria-expanded={showLog} onClick={() => setShowLog(s => !s)}>
          <span>
            <span className="ui-row-title ui-block">Payment log</span>
            <span className="ui-row-sub ui-block">{savedCount} day{savedCount === 1 ? '' : 's'} · {formatNaira(totalSaved, { minor: false })} in {MONTHS[calMonth]}</span>
          </span>
          <Icons.expand size={20} aria-hidden="true" className={showLog ? 'is-open' : undefined} />
        </button>
        {showLog && (
          <div className="ui-card ui-card--list">
            {maxDay === 0 && <p className="ui-note ui-note--center">Nothing yet for this month.</p>}
            {Array.from({ length: maxDay }, (_, i) => maxDay - i).filter(d => (days[d]?.amount ?? 0) > 0 || (!flexCal && !beforePlan(d) && !afterPlan(d))).map(d => {
              const v = days[d]?.amount ?? 0
              const isToday = isCurMo && d === today.getDate()
              const date = new Date(calYear, calMonth, d)
              return (
                <button key={d} type="button" className="ui-row ui-row--button ag-log-row" onClick={() => setActiveDay(d)}>
                  <span className={`ag-log-date${v > 0 ? ' is-saved' : isToday ? '' : ' is-missed'}`} aria-hidden="true">
                    <strong>{d}</strong><span>{DOW[date.getDay()]}</span>
                  </span>
                  <span className="ui-row-main">
                    <span className="ui-row-title ui-block">{v > 0 ? formatNaira(v, { minor: false }) : isToday ? 'Not yet today' : 'Missed'}</span>
                    {v > 0 && <span className="ui-row-sub ui-block">{days[d]?.time} · {formatNaira(running[d] ?? 0, { minor: false })} so far</span>}
                  </span>
                  <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </section>

      {!wide && (
        <BottomSheet open={activeDay !== null} onClose={() => setActiveDay(null)} title="Day details">
          {dayDetail}
        </BottomSheet>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  )
}
