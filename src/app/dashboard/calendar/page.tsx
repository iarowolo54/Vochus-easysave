'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const AVATAR_COLORS = ['#1a6b3a','#1a5fa8','#c8841a','#c0392b','#7c3aed','#0891b2','#be185d','#065f46']
function avatarColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function fmt(n: number) {
  return n >= 1000 ? `₦${(n/1000).toFixed(1)}K` : `₦${n}`
}

interface CustomerTile {
  id: string
  customerId: string
  name: string
  phone: string
  plan: { dailyAmount: number; periodDays: number; startDate: string; maturityDate: string; balance: number } | null
  monthStats: { saved: number; missed: number; total: number; pct: number; bestStreak: number }
}

interface DayData { amount: number; ref: string; time: string }

interface CalCustomer {
  id: string; customerId: string; name: string; phone: string
}

interface CalPlan {
  id: string; dailyAmount: number; periodDays: number
  startDate: string; maturityDate: string; balance: number
}

function CalendarPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const today = new Date()
  const [calYear,  setCalYear]  = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [search,   setSearch]   = useState('')
  const [customers, setCustomers] = useState<CustomerTile[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const [selected,   setSelected]   = useState<CalCustomer | null>(null)
  const [plan,       setPlan]       = useState<CalPlan | null>(null)
  const [days,       setDays]       = useState<Record<number, DayData>>({})
  const [loadingCal, setLoadingCal] = useState(false)
  const [activeDay,  setActiveDay]  = useState<number | null>(null)

  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeDay !== null && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeDay])

  const cidParam = searchParams.get('cid')

  useEffect(() => {
    fetch(`/api/calendar?year=${today.getFullYear()}&month=${today.getMonth()}`)
      .then(r => r.json())
      .then(d => {
        const list: CustomerTile[] = d.customers ?? []
        setCustomers(list)
        if (cidParam) {
          const match = list.find(c => c.customerId === cidParam)
          if (match) selectCustomer(match)
        }
      })
      .finally(() => setLoadingList(false))
  }, [cidParam])

  const loadCalendar = useCallback((cid: string, yr: number, mo: number) => {
    setLoadingCal(true)
    setActiveDay(null)
    fetch(`/api/calendar?year=${yr}&month=${mo}&customerId=${cid}`)
      .then(r => r.json())
      .then(d => {
        setPlan(d.plan ?? null)
        setDays(d.days ?? {})
      })
      .finally(() => setLoadingCal(false))
  }, [])

  function selectCustomer(c: CustomerTile) {
    setSelected({ id: c.id, customerId: c.customerId, name: c.name, phone: c.phone })
    setPlan(c.plan as CalPlan | null)
    setDays({})
    setCalYear(today.getFullYear())
    setCalMonth(today.getMonth())
    loadCalendar(c.id, today.getFullYear(), today.getMonth())
  }

  function clearCustomer() {
    setSelected(null); setPlan(null); setDays({}); setSearch(''); setActiveDay(null)
  }

  function prevMonth() {
    let y = calYear, m = calMonth - 1
    if (m < 0) { m = 11; y-- }
    setCalYear(y); setCalMonth(m)
    if (selected) loadCalendar(selected.id, y, m)
  }

  function nextMonth() {
    let y = calYear, m = calMonth + 1
    if (m > 11) { m = 0; y++ }
    setCalYear(y); setCalMonth(m)
    if (selected) loadCalendar(selected.id, y, m)
  }

  function goToday() {
    setCalYear(today.getFullYear()); setCalMonth(today.getMonth())
    if (selected) loadCalendar(selected.id, today.getFullYear(), today.getMonth())
  }

  function showDay(d: number) {
    setActiveDay(d)
  }

  const dim      = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const prevDim  = new Date(calYear, calMonth, 0).getDate()
  const isCurMo  = calYear === today.getFullYear() && calMonth === today.getMonth()
  const maxDay   = isCurMo ? today.getDate() : dim

  let savedCount = 0, missedCount = 0, totalSaved = 0, bestStreak = 0, cur = 0
  for (let d = 1; d <= maxDay; d++) {
    const v = days[d]?.amount ?? 0
    if (v > 0) { savedCount++; totalSaved += v; cur++; bestStreak = Math.max(bestStreak, cur) }
    else { missedCount++; cur = 0 }
  }
  const pct = (savedCount + missedCount) > 0 ? Math.round(savedCount / (savedCount + missedCount) * 100) : 0
  const monthTarget = (plan?.dailyAmount ?? 0) * dim
  const progPct = monthTarget > 0 ? Math.min(100, Math.round(totalSaved / monthTarget * 100)) : 0

  const running: Record<number, number> = {}
  let rt = 0
  for (let d = 1; d <= maxDay; d++) { rt += days[d]?.amount ?? 0; running[d] = rt }

  const filtered = customers.filter(c =>
    !search.trim() ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.customerId.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  )

  const activeAmount = activeDay ? (days[activeDay]?.amount ?? 0) : 0

  return (
    <div>
      {!selected ? (
        <>
          <div className="page-header">
            <h2>Savings Calendar</h2>
            <p>Select a customer to view their monthly payment calendar</p>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text3)', marginBottom: 12 }}>Find Customer</div>
            <div className="isearch" style={{ marginBottom: 12 }}>
              <span className="sicon">🔍</span>
              <input
                className="finput"
                type="text"
                placeholder="Type name, phone or ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loadingList ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Loading customers…</div>
          ) : (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text3)', marginBottom: 10 }}>Your Customers</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', padding: 8 }}>No customers found</div>}
                {filtered.map(c => {
                  const { pct, total } = c.monthStats
                  const col = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--gold)' : 'var(--red)'
                  const bg  = pct >= 80 ? 'var(--green)' : pct >= 60 ? '#c8841a' : '#c0392b'
                  return (
                    <div
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--card)', border: '1.5px solid var(--border)', borderRadius: 13, padding: '13px 16px', cursor: 'pointer', transition: 'all .15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--green)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(26,107,58,.12)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
                    >
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(c.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{initials(c.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{c.customerId} · {c.plan ? `${c.plan.periodDays}-Day Plan` : 'No active plan'}{c.plan ? ` · ₦${c.plan.dailyAmount.toLocaleString()}/day` : ''}</div>
                        <div style={{ marginTop: 6, height: 4, background: 'var(--border)', borderRadius: 100, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: bg, borderRadius: 100 }} />
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-head)', color: col }}>{pct}%</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>This month</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', marginTop: 3 }}>₦{(total/1000).toFixed(1)}K</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* Customer header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarColor(selected.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>{initials(selected.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text1)' }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{selected.customerId} · {plan ? `${plan.periodDays}-Day Plan · ₦${plan.dailyAmount.toLocaleString()}/day target` : 'No active plan'}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text3)' }}>Consistency</div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-head)', color: pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--gold)' : 'var(--red)' }}>{pct}%</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={clearCustomer} style={{ flexShrink: 0 }}>← Back</button>
          </div>

          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={prevMonth}>‹</button>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text1)', minWidth: 130, textAlign: 'center', fontFamily: 'var(--font-head)' }}>{MONTHS[calMonth]} {calYear}</span>
              <button className="btn btn-outline btn-sm" onClick={nextMonth}>›</button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={goToday}>Today</button>
          </div>

          {/* Stats */}
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card green">
              <div className="stat-icon" style={{ background: 'var(--green-light)', width: 32, height: 32, fontSize: 14 }}>✅</div>
              <div className="stat-label" style={{ fontSize: 10.5 }}>Days Saved</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{savedCount}</div>
              <div className="stat-sub" style={{ fontSize: 10 }}>of {savedCount + missedCount} working days</div>
            </div>
            <div className="stat-card" style={{ borderColor: '#fdecea', background: '#fdecea' }}>
              <div className="stat-icon" style={{ background: 'rgba(192,57,43,.08)', width: 32, height: 32, fontSize: 14 }}>❌</div>
              <div className="stat-label" style={{ fontSize: 10.5 }}>Days Missed</div>
              <div className="stat-value" style={{ fontSize: 22, color: 'var(--red)' }}>{missedCount}</div>
              <div className="stat-sub" style={{ fontSize: 10 }}>Collection gaps</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-icon" style={{ background: 'var(--blue-light)', width: 32, height: 32, fontSize: 14 }}>💰</div>
              <div className="stat-label" style={{ fontSize: 10.5 }}>Total Saved</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{fmt(totalSaved)}</div>
              <div className="stat-sub" style={{ fontSize: 10 }}>of {fmt(monthTarget)} target</div>
            </div>
            <div className="stat-card gold">
              <div className="stat-icon" style={{ background: 'var(--gold-light)', width: 32, height: 32, fontSize: 14 }}>🔥</div>
              <div className="stat-label" style={{ fontSize: 10.5 }}>Best Streak</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{bestStreak}</div>
              <div className="stat-sub" style={{ fontSize: 10 }}>consecutive days</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>Monthly Target Progress</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--font-head)' }}>{progPct}%</span>
            </div>
            <div style={{ height: 10, background: 'var(--border)', borderRadius: 100, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${progPct}%`, background: 'linear-gradient(90deg,var(--green),#2ecc71)', borderRadius: 100, transition: 'width .6s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)' }}>
              <span>₦{totalSaved.toLocaleString()} saved</span>
              <span>₦{monthTarget.toLocaleString()} monthly target</span>
            </div>
          </div>

          {/* Calendar grid */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#134f2b' }}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} style={{ padding: '9px 4px', textAlign: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>{d}</div>
              ))}
            </div>
            {loadingCal ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderTop: '1px solid var(--border)' }}>
                {/* Prev-month padding cells */}
                {Array.from({ length: firstDay }, (_, i) => (
                  <div key={`p${i}`} style={{ borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', minHeight: 76, padding: '7px 6px', background: '#fafafa', opacity: .45 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ccc' }}>{prevDim - firstDay + 1 + i}</div>
                  </div>
                ))}

                {/* Current month cells */}
                {Array.from({ length: dim }, (_, i) => {
                  const d = i + 1
                  const isFuture = !isCurMo
                    ? (calYear > today.getFullYear() || (calYear === today.getFullYear() && calMonth > today.getMonth()))
                    : d > today.getDate()
                  const isToday  = isCurMo && d === today.getDate()
                  // TODAY is NOT clickable (matches mockup)
                  const clickable = !isFuture && !isToday
                  const v = days[d]?.amount ?? 0
                  const hasSaved  = !isFuture && v > 0
                  const hasMissed = !isFuture && !isToday && v === 0

                  let bg = 'var(--card)'
                  if (hasSaved)            bg = 'linear-gradient(180deg,#e6f4ec 0%,#fff 50%)'
                  if (hasMissed)           bg = 'linear-gradient(180deg,#fdecea 0%,#fff 50%)'
                  if (isFuture && !isToday) bg = '#f7f9fb'

                  const isActive = activeDay === d

                  return (
                    <div
                      key={d}
                      onClick={() => clickable ? showDay(d) : undefined}
                      style={{
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        minHeight: 76, padding: '7px 6px',
                        background: bg,
                        boxShadow: isToday ? 'inset 0 0 0 2.5px var(--green)' : isActive ? 'inset 0 0 0 2px var(--green)' : undefined,
                        cursor: clickable ? 'pointer' : 'default',
                        position: 'relative',
                        transition: 'background .12s',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? 'var(--green)' : 'var(--text1)', marginBottom: 4 }}>{d}</div>
                      {hasSaved && <>
                        <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-head)', color: '#1a6b3a' }}>{v >= 1000 ? `₦${(v/1000).toFixed(1)}K` : `₦${v}`}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>∑ ₦{((running[d] ?? 0)/1000).toFixed(1)}K</div>
                        <div style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#1a6b3a' }} />
                      </>}
                      {hasMissed && <>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#c0392b' }}>Missed</div>
                        <div style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#c0392b' }} />
                      </>}
                      {isToday && <div style={{ fontSize: 10.5, color: 'var(--green)', fontWeight: 700, marginTop: 2 }}>Today</div>}
                      {isFuture && !isToday && <div style={{ fontSize: 9.5, color: '#ccc', marginTop: 3 }}>—</div>}
                    </div>
                  )
                })}

                {/* Next-month trailing cells */}
                {(() => {
                  const trail = (firstDay + dim) % 7 === 0 ? 0 : 7 - ((firstDay + dim) % 7)
                  return Array.from({ length: trail }, (_, i) => (
                    <div key={`n${i}`} style={{ borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', minHeight: 76, padding: '7px 6px', background: '#fafafa', opacity: .45 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#ccc' }}>{i + 1}</div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="card" style={{ padding: '12px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>Legend:</span>
              {[
                { color: '#1a6b3a', label: 'Saved ✓' },
                { color: '#c0392b', label: 'Missed ✗' },
                { color: '#f7f8f9', border: '1px solid #ddd', label: 'Future' },
                { color: 'transparent', border: '2.5px solid #1a6b3a', label: 'Today' },
              ].map(({ color, border, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: color, border }} />
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Day detail panel — appears on click, scrolls into view */}
          {activeDay !== null && (
            <div ref={detailRef} style={{ marginBottom: 16 }}>
              <div className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--green)' }}>
                {/* Green header */}
                <div style={{ background: 'var(--green)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                      {DAYS[new Date(calYear, calMonth, activeDay).getDay()]}, {MONTHS[calMonth]} {activeDay} {calYear}
                    </div>
                    <div style={{ fontSize: 12, color: activeAmount > 0 ? 'rgba(255,255,255,.75)' : '#ffaaaa' }}>
                      {activeAmount > 0
                        ? `₦${activeAmount.toLocaleString()} saved · Running: ₦${(running[activeDay] ?? 0).toLocaleString()}`
                        : 'Missed — no collection recorded'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Record Now always visible in header */}
                    <button
                      className="btn btn-sm"
                      onClick={() => router.push(`/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}&date=${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(activeDay).padStart(2,'0')}`)}
                      style={{ background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', fontSize: 11.5 }}
                    >
                      + Record Now
                    </button>
                    <button
                      onClick={() => setActiveDay(null)}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.7)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Detail body */}
                <div style={{ padding: '16px 18px' }}>
                  {activeAmount > 0 ? (
                    <>
                      {([
                        ['Amount Saved', `₦${activeAmount.toLocaleString()}`, 'green'],
                        ['Daily Target', `₦${(plan?.dailyAmount ?? 0).toLocaleString()}`, ''],
                        ['vs Target',
                          activeAmount === plan?.dailyAmount
                            ? 'Exact target amount'
                            : activeAmount > (plan?.dailyAmount ?? 0)
                            ? `+${Math.round((activeAmount / (plan?.dailyAmount ?? 1) - 1) * 100)}% above target 🎉`
                            : `${Math.round((activeAmount / (plan?.dailyAmount ?? 1) - 1) * 100)}% below target`,
                          activeAmount >= (plan?.dailyAmount ?? 0) ? 'green' : 'gold'],
                        ['Running Total (this month)', `₦${(running[activeDay] ?? 0).toLocaleString()}`, 'green'],
                        ['Collection Time', days[activeDay]?.time ?? '—', ''],
                        ['Transaction Reference', days[activeDay]?.ref ?? '—', 'mono'],
                      ] as [string,string,string][]).map(([lbl, val, cls]) => (
                        <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                          <span style={{ color: 'var(--text3)' }}>{lbl}</span>
                          <span style={{
                            fontWeight: 700,
                            color: cls === 'green' ? 'var(--green)' : cls === 'gold' ? 'var(--gold)' : 'var(--text1)',
                            fontFamily: cls === 'mono' ? 'monospace' : undefined,
                            fontSize: cls === 'mono' ? 11.5 : undefined,
                          }}>{val}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                        <div style={{ fontSize: 32 }}>❌</div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>No saving recorded</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>{selected.name} did not save on this day.</div>
                        </div>
                      </div>
                      {/* Full-width record button — matches mockup */}
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => router.push(`/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}&date=${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(activeDay).padStart(2,'0')}`)}
                        style={{ width: '100%', marginTop: 8 }}
                      >
                        + Record a late saving for this day
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Full month payment log */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)' }}>Full Month Payment Log</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{savedCount} days · ₦{totalSaved.toLocaleString()} total</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Amount</th>
                    <th>Running Total</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => {
                    const v       = days[d]?.amount ?? 0
                    const date    = new Date(calYear, calMonth, d)
                    const dow     = DAYS[date.getDay()].slice(0, 3)
                    const dateStr = `${String(d).padStart(2,'0')} ${MONTHS[calMonth].slice(0,3)}`
                    const hasSaved  = v > 0
                    const isToday   = isCurMo && d === today.getDate()
                    const daily     = plan?.dailyAmount ?? 0

                    const badge = isToday
                      ? <span className="badge badge-blue">Today</span>
                      : hasSaved
                      ? <span className="badge badge-green">✓ Saved</span>
                      : <span className="badge badge-red">✗ Missed</span>

                    const note = v > daily ? '↑ Above target' : v < daily && v > 0 ? '↓ Below target' : hasSaved ? '✓ On target' : ''
                    const noteColor = v > daily ? 'var(--green)' : v < daily && v > 0 ? 'var(--gold)' : 'var(--text3)'

                    return (
                      <tr key={d} style={{ background: activeDay === d ? 'var(--green-light)' : undefined }}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{dateStr}</td>
                        <td style={{ color: 'var(--text3)', fontSize: 12 }}>{dow}</td>
                        <td style={{ fontFamily: 'var(--font-head)', color: hasSaved ? 'var(--green)' : 'var(--text3)', fontWeight: hasSaved ? 700 : 400 }}>{hasSaved ? `₦${v.toLocaleString()}` : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-head)', fontSize: 12, color: 'var(--green)' }}>{(running[d] ?? 0) > 0 ? `₦${running[d].toLocaleString()}` : '—'}</td>
                        <td>{badge}</td>
                        <td style={{ fontSize: 11.5, color: noteColor }}>{note}</td>
                      </tr>
                    )
                  })}
                  {maxDay === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>No data yet for this month</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
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
