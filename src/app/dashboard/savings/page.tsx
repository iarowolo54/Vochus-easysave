'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; planDays: number | null; planId: string | null
  planStatus: string | null; dailyAmount: number | null; photoUrl?: string | null
  savingsPlans?: { id: string; goal: string; status: string; maturityDate: string | null }[]
}

interface TodaySaving { name: string; time: string; method: string; amount: number }

export default function SavingsPage() {
  return <Suspense><SavingsContent /></Suspense>
}

function maskPhone(p: string) {
  if (!p || p.length < 7) return p
  return p.slice(0, 4) + '****' + p.slice(-3)
}

function SavingsContent() {
  const { update, data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [todaySavings, setTodaySavings] = useState<TodaySaving[]>([])
  const [todayTotal, setTodayTotal] = useState(0)
  const [newPlan, setNewPlan] = useState({ dailyAmount: '', periodDays: '90', goal: '', startDate: '', cadence: 'daily' as 'daily' | 'weekly' | 'monthly' })

  const [hasPin, setHasPin] = useState(true)
  const [lastReceipt, setLastReceipt] = useState<null | { ref: string; customer: string; customerId: string; phone: string; amount: number; balance: number; method: string; agent: string; date: string; goal?: string; maturityDate?: string; inviteUrl?: string }>(null)
  const recordDate = searchParams.get('date') ?? null

  // Bulk payment
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [paidDates, setPaidDates] = useState<string[]>([])
  const [planStartDate, setPlanStartDate] = useState<string | null>(null)
  const [paidDatesLoading, setPaidDatesLoading] = useState(false)
  const [calendarView, setCalendarView] = useState<{ year: number; month: number }>(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }
  })

  // PIN modal
  const [pinModal, setPinModal] = useState(false)
  const [noPinModal, setNoPinModal] = useState(false)
  const [pinEntry, setPinEntry] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinVerifying, setPinVerifying] = useState(false)

  useEffect(() => {
    fetch('/api/agent').then(r => r.json()).then(d => setHasPin(!!d.agent?.hasPin))
  }, [])

  useEffect(() => {
    if (!bulkMode || !selected?.planId) return
    setPaidDatesLoading(true)
    const n = new Date()
    setCalendarView({ year: n.getFullYear(), month: n.getMonth() })
    fetch(`/api/transactions/saving/paid-dates?planId=${selected.planId}`)
      .then(r => r.json())
      .then(d => {
        setPaidDates(d.paidDates ?? [])
        setPlanStartDate(d.planStartDate ?? null)
        setSelectedDates([])
      })
      .finally(() => setPaidDatesLoading(false))
  }, [bulkMode, selected?.planId])

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid) return
    fetch(`/api/customers?search=${encodeURIComponent(cid)}&limit=1`)
      .then(r => r.json())
      .then(d => {
        const c = d.customers?.[0]
        if (c) { setSelected(c); setQuery(`${c.firstName} ${c.lastName}`) }
      })
  }, [searchParams])

  const search = useCallback(async () => {
    if (!query.trim()) { setResults([]); return }
    const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=5`)
    const data = await res.json()
    setResults(data.customers ?? [])
  }, [query])

  useEffect(() => {
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (selected?.dailyAmount) setAmount(String(selected.dailyAmount))
  }, [selected])

  useEffect(() => {
    fetch('/api/transactions?type=saving')
      .then(r => r.json())
      .then(d => {
        setTodayTotal(d.stats?.todaySavings ?? 0)
        const today = d.transactions?.filter((t: any) => {
          const d2 = new Date(t.createdAt)
          const now = new Date()
          return d2.toDateString() === now.toDateString()
        }).slice(0, 5).map((t: any) => ({
          name: t.customer?.name ?? '—',
          time: new Date(t.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          method: t.method ?? 'Cash',
          amount: t.amount,
        })) ?? []
        setTodaySavings(today)
      })
  }, [toast])

  async function createPlan() {
    if (!selected) return
    if (!newPlan.dailyAmount || !newPlan.goal) { setError('Fill all plan fields'); return }
    setLoading(true); setError('')
    const rawAmt = parseFloat(newPlan.dailyAmount)
    const isWeekly = newPlan.cadence === 'weekly'
    const isMonthly = newPlan.cadence === 'monthly'
    const dailyEquiv = isWeekly ? rawAmt / 7 : isMonthly ? rawAmt / 30 : rawAmt
    const res = await fetch('/api/customers/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: selected.id,
        dailyAmount: String(dailyEquiv),
        periodDays: newPlan.periodDays,
        goal: newPlan.goal,
        cadence: newPlan.cadence,
        startDate: newPlan.startDate || undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setLoading(false); return }
    setToast(`New savings plan created for ${selected.firstName} ${selected.lastName}`)
    setSelected(null); setQuery(''); setAmount(''); setResults([])
    setNewPlan({ dailyAmount: '', periodDays: '90', goal: '', startDate: '', cadence: 'daily' })
    setLoading(false)
    update()
    setTimeout(() => setToast(''), 4000)
  }

  function requestPin() {
    if (!selected) { setError('Select a customer first'); return }
    if (!bulkMode && (!amount || parseFloat(amount) <= 0)) { setError('Enter a valid amount'); return }
    if (bulkMode && (!selected.dailyAmount || selectedDates.length < 1)) { setError('Select at least 1 date'); return }
    setError('')
    if (!hasPin) { setNoPinModal(true); return }
    setPinEntry(''); setPinError(''); setPinModal(true)
  }

  async function confirmPin() {
    if (!pinEntry) { setPinError('Enter your PIN'); return }
    setPinVerifying(true); setPinError('')
    const res = await fetch('/api/agent/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinEntry }),
    })
    const data = await res.json()
    setPinVerifying(false)
    if (!res.ok) {
      if (res.status === 403) {
        setPinModal(false)
        setError('No transaction PIN set. Go to Settings → Transaction PIN to set one up.')
      } else {
        setPinError(data.error ?? 'Incorrect PIN')
      }
      return
    }
    setPinModal(false)
    await submit()
  }

  async function submit() {
    if (!selected) return
    setLoading(true); setError('')

    const isBulk = bulkMode && !recordDate
    const endpoint = isBulk ? '/api/transactions/saving/bulk' : '/api/transactions/saving'
    const body = isBulk
      ? { customerId: selected.id, dates: selectedDates, method }
      : { customerId: selected.id, amount, method, ...(recordDate ? { date: recordDate } : {}) }

    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setLoading(false); return }
    setLoading(false)
    update()

    if (recordDate) {
      router.push(`/dashboard/calendar?cid=${encodeURIComponent(selected.customerId)}&t=${Date.now()}`)
      return
    }

    const totalAmt = isBulk ? (data.total ?? 0) : parseFloat(amount)
    const label = isBulk ? `₦${totalAmt.toLocaleString()} (${selectedDates.length} days)` : `₦${totalAmt.toLocaleString()}`
    setToast(`${label} saved for ${selected.firstName} ${selected.lastName}`)

    const activePlan = (selected as any).savingsPlans?.find((p: any) => p.status === 'Active') ?? (selected as any).savingsPlans?.[0]
    const agentUser = session?.user as any
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const inviteUrl = agentUser?.agentId ? `${origin}/customer/enroll?aid=${agentUser.agentId}` : ''
    setLastReceipt({
      ref: isBulk ? `${data.transactions?.[0]?.ref ?? ''} +${selectedDates.length - 1} more` : (data.transaction?.ref ?? ''),
      customer: `${selected.firstName} ${selected.lastName}`,
      customerId: selected.customerId ?? '',
      phone: maskPhone(selected.phone ?? ''),
      amount: totalAmt,
      balance: (selected.savingsBalance ?? 0) + totalAmt,
      method,
      agent: agentUser?.name ?? '',
      date: new Date().toLocaleString('en-GB'),
      goal: activePlan?.goal ?? '',
      maturityDate: activePlan?.maturityDate ? new Date(activePlan.maturityDate).toLocaleDateString('en-GB') : '',
      inviteUrl,
    })
    setSelected(null); setQuery(''); setAmount(''); setResults([]); setBulkMode(false); setSelectedDates([])
    setTimeout(() => setToast(''), 4000)
  }

  return (
    <>
      <div className="page-header">
        <h2>Record Saving</h2>
        <p>Credit a customer&apos;s daily savings</p>
      </div>

      {recordDate && (
        <div className="alert alert-b" style={{ marginBottom: 16 }}>
          📅 Recording a <strong>late saving</strong> for <strong>{new Date(recordDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        </div>
      )}
      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {lastReceipt && (
        <div style={{ background: '#e6f4ec', border: '1px solid #9dd1b3', borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Last saving: ₦{lastReceipt.amount.toLocaleString()} — {lastReceipt.customer}</div>
            <div style={{ fontSize: 12, color: 'var(--mu)' }}>Ref {lastReceipt.ref}</div>
          </div>
          {typeof window !== 'undefined' && (window as unknown as { __vochusCanPrint?: boolean; VochusPrinter?: { postMessage: (s: string) => void } }).__vochusCanPrint && (
            <button
              className="btn btn-g btn-sm"
              onClick={() => {
                const w = window as unknown as { VochusPrinter?: { postMessage: (s: string) => void } }
                w.VochusPrinter?.postMessage(JSON.stringify(lastReceipt))
              }}
            >🖨 Print Receipt</button>
          )}
          <button className="btn btn-out btn-sm" onClick={() => setLastReceipt(null)}>Dismiss</button>
        </div>
      )}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      <div className="grid g-2-1">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Find Customer</div>
            <div className="isearch" style={{ marginBottom: 10 }}>
              <span className="sicon">🔍</span>
              <input
                className="finput" type="text" placeholder="Name, phone or ID…"
                value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }}
              />
            </div>
            {results.length > 0 && !selected && (
              <div style={{ border: '1px solid var(--br)', borderRadius: 8, overflow: 'hidden' }}>
                {results.map(c => (
                  <div
                    key={c.id}
                    className="lookup-box show"
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--br)' }}
                    onClick={() => { setSelected(c); setResults([]); setQuery(`${c.firstName} ${c.lastName}`) }}
                  >
                    {c.photoUrl ? <img src={c.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-g">{c.firstName[0]}{c.lastName[0]}</div>}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{c.customerId} · {c.phone}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                        Savings: ₦{c.savingsBalance.toLocaleString()} · Plan: {c.planDays ?? '—'} Days
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selected && (
              <div className="lookup-box show">
                {selected.photoUrl ? <img src={selected.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-g">{selected.firstName[0]}{selected.lastName[0]}</div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{selected.firstName} {selected.lastName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{selected.customerId} · {selected.phone}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                    Savings: ₦{selected.savingsBalance.toLocaleString()} · Plan: {selected.planDays ?? '—'} Days
                  </div>
                </div>
                <button className="btn btn-out btn-sm" onClick={() => { setSelected(null); setQuery('') }}>✕</button>
              </div>
            )}
          </div>
          {selected && selected.planStatus === 'Redeemed' && (() => {
            const isW = newPlan.cadence === 'weekly'
            const isM = newPlan.cadence === 'monthly'
            const rawAmt = parseFloat(newPlan.dailyAmount) || 0
            const dailyEquiv = isW ? rawAmt / 7 : isM ? rawAmt / 30 : rawAmt
            const previewTotal = rawAmt && newPlan.periodDays ? Math.round(dailyEquiv * parseInt(newPlan.periodDays)) : 0
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Create Savings Plan</div>
                <div className="alert alert-rd" style={{ marginBottom: 14, lineHeight: 1.5, fontSize: 13 }}>
                  🔒 Previous plan redeemed — create a new savings plan to continue collecting.
                </div>
                <label className="flabel">Saving Frequency</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {(['daily', 'weekly', 'monthly'] as const).map(c => (
                    <button key={c} onClick={() => setNewPlan(p => ({ ...p, cadence: c, periodDays: c === 'daily' ? '90' : c === 'weekly' ? '56' : '60' }))}
                      style={{ padding: '8px 14px', borderRadius: 8, border: `2px solid ${newPlan.cadence === c ? 'var(--g)' : 'var(--br)'}`, background: newPlan.cadence === c ? 'var(--gl)' : 'var(--card)', color: newPlan.cadence === c ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                      {c === 'daily' ? '📅 Daily' : c === 'weekly' ? '📆 Weekly' : '🗓️ Monthly'}
                    </button>
                  ))}
                </div>
                <label className="flabel">{isW ? 'Weekly' : isM ? 'Monthly' : 'Daily'} Amount (₦)</label>
                <input className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus}
                  placeholder={isW ? 'e.g. 3500' : isM ? 'e.g. 15000' : 'e.g. 500'} style={{ marginBottom: 10 }}
                  value={newPlan.dailyAmount} onChange={e => setNewPlan(p => ({ ...p, dailyAmount: nonNegativeString(e.target.value) }))} />
                <label className="flabel">Saving Period {isW ? '(Weeks)' : isM ? '(Months)' : '(Days)'}</label>
                <select className="finput" style={{ marginBottom: 10 }} value={newPlan.periodDays} onChange={e => setNewPlan(p => ({ ...p, periodDays: e.target.value }))}>
                  {isW ? (<>
                    <option value="28">4 Weeks</option><option value="56">8 Weeks</option>
                    <option value="84">12 Weeks</option><option value="168">24 Weeks</option><option value="364">52 Weeks</option>
                  </>) : isM ? (<>
                    <option value="30">1 Month</option><option value="60">2 Months</option>
                    <option value="90">3 Months</option><option value="180">6 Months</option><option value="365">12 Months</option>
                  </>) : (<>
                    <option value="31">31 Days</option><option value="62">62 Days</option>
                    <option value="90">90 Days</option><option value="180">180 Days</option><option value="365">365 Days</option>
                  </>)}
                </select>
                <label className="flabel">Goal / Purpose</label>
                <input className="finput" type="text" placeholder="e.g. School fees, Business capital" style={{ marginBottom: 10 }}
                  value={newPlan.goal} onChange={e => setNewPlan(p => ({ ...p, goal: e.target.value }))} />
                <label className="flabel">Start Date (optional)</label>
                <input className="finput" type="date" style={{ marginBottom: previewTotal > 0 ? 10 : 0 }}
                  value={newPlan.startDate} onChange={e => setNewPlan(p => ({ ...p, startDate: e.target.value }))} />
                {previewTotal > 0 && (() => {
                  const deductionPreview = previewTotal > 0
                    ? (isW || isM
                      ? Math.round(previewTotal * 0.20 * 100) / 100
                      : Math.round(dailyEquiv * (parseInt(newPlan.periodDays) / 31) * 100) / 100)
                    : 0
                  return (
                    <div style={{ background: 'var(--gl)', border: '1px solid var(--br)', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: deductionPreview > 0 ? 4 : 0 }}>
                        <span style={{ color: 'var(--mu)' }}>Target at maturity</span>
                        <strong style={{ color: 'var(--g)' }}>₦{previewTotal.toLocaleString()}</strong>
                      </div>
                      {deductionPreview > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--rd)' }}>Platform deduction at maturity</span>
                          <strong style={{ color: 'var(--rd)' }}>-₦{deductionPreview.toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })()}
          {selected && selected.planStatus !== 'Redeemed' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="card-title" style={{ margin: 0 }}>Saving Details</div>
                {!recordDate && (
                  <button
                    onClick={() => setBulkMode(b => !b)}
                    style={{ padding: '5px 12px', borderRadius: 100, border: `1.5px solid ${bulkMode ? 'var(--g)' : 'var(--br)'}`, background: bulkMode ? 'var(--gl)' : 'transparent', color: bulkMode ? 'var(--g)' : 'var(--mu)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {bulkMode ? '📅 Bulk ON' : '📅 Bulk Pay'}
                  </button>
                )}
              </div>

              {bulkMode && !recordDate ? (
                <>
                  <div style={{ background: 'var(--gl)', border: '1px solid var(--br)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 10 }}>Tap dates to select — each day recorded separately at ₦{selected.dailyAmount?.toLocaleString()}/day</div>
                    {paidDatesLoading ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--mu)', fontSize: 13 }}>Loading dates…</div>
                    ) : !planStartDate ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--mu)', fontSize: 13 }}>No active plan found</div>
                    ) : (() => {
                      const { year: cvY, month: cvM } = calendarView
                      const today = new Date()
                      function toDS(y: number, m: number, d: number) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
                      const todayStr = toDS(today.getFullYear(), today.getMonth(), today.getDate())
                      const paidSet = new Set(paidDates)
                      const selectedSet = new Set(selectedDates)
                      const planStart = new Date(planStartDate + 'T00:00:00')
                      const planStartMonth = new Date(planStart.getFullYear(), planStart.getMonth(), 1)
                      const viewMonth = new Date(cvY, cvM, 1)
                      const canGoPrev = viewMonth > planStartMonth
                      const MN = ['January','February','March','April','May','June','July','August','September','October','November','December']
                      const DL = ['M','T','W','T','F','S','S']
                      const numDays = new Date(cvY, cvM + 1, 0).getDate()
                      const offset = (new Date(cvY, cvM, 1).getDay() + 6) % 7
                      const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({length: numDays}, (_,i) => i+1)]
                      while (cells.length % 7 !== 0) cells.push(null)
                      function navMonth(delta: number) {
                        setCalendarView(v => {
                          let m = v.month + delta, y = v.year
                          if (m < 0) { m = 11; y-- }
                          if (m > 11) { m = 0; y++ }
                          return { year: y, month: m }
                        })
                      }
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <button
                              onClick={() => navMonth(-1)}
                              disabled={!canGoPrev}
                              style={{ background: 'none', border: 'none', fontSize: 20, cursor: canGoPrev ? 'pointer' : 'default', color: canGoPrev ? 'var(--g)' : 'var(--br)', padding: '0 6px', fontFamily: 'inherit' }}
                            >‹</button>
                            <div style={{ fontWeight: 800, fontSize: 14 }}>{MN[cvM]} {cvY}</div>
                            <button
                              onClick={() => navMonth(1)}
                              style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--g)', padding: '0 6px', fontFamily: 'inherit' }}
                            >›</button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                            {DL.map((l,i) => (
                              <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--mu)', paddingBottom: 4 }}>{l}</div>
                            ))}
                            {cells.map((day, idx) => {
                              if (!day) return <div key={idx} />
                              const ds = toDS(cvY, cvM, day)
                              const thisDate = new Date(cvY, cvM, day)
                              const beforeStart = thisDate < planStart
                              const isPaid = paidSet.has(ds)
                              const isSel = selectedSet.has(ds)
                              const isToday = ds === todayStr
                              const disabled = beforeStart || isPaid
                              let bg = 'transparent', color = 'var(--fg)', fw: number | string = 600
                              if (beforeStart) { color = 'var(--br)' }
                              else if (isPaid) { bg = 'var(--g)'; color = '#fff'; fw = 700 }
                              else if (isSel) { bg = 'var(--g)'; color = '#fff'; fw = 800 }
                              return (
                                <div
                                  key={idx}
                                  onClick={() => !disabled && setSelectedDates(prev => prev.includes(ds) ? prev.filter(x => x !== ds) : [...prev, ds])}
                                  style={{
                                    textAlign: 'center', padding: '7px 0', borderRadius: 8,
                                    fontSize: 13, fontWeight: fw,
                                    background: bg, color,
                                    opacity: beforeStart ? 0.3 : 1,
                                    cursor: disabled ? 'default' : 'pointer',
                                    border: isToday && !isPaid && !isSel ? '2px solid var(--g)' : '2px solid transparent',
                                    userSelect: 'none' as const,
                                  }}
                                >
                                  {isPaid ? '✓' : day}
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--br)' }}>
                            <div>
                              {selectedDates.length > 0 ? (
                                <span style={{ fontSize: 12, color: 'var(--mu)' }}>{selectedDates.length} day{selectedDates.length > 1 ? 's' : ''} selected</span>
                              ) : (
                                <span style={{ fontSize: 12, color: 'var(--mu)' }}>No dates selected</span>
                              )}
                            </div>
                            {selected.dailyAmount && selectedDates.length > 0 && (
                              <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--g)', fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                                ₦{(selected.dailyAmount * selectedDates.length).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {selectedDates.length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 4 }}>
                              {[...selectedDates].sort().map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(', ')}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <label className="flabel">Amount (₦) — Agreed daily contribution</label>
                  <input
                    className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="Enter amount"
                    style={{ fontSize: 28, fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, textAlign: 'center', padding: 14, marginBottom: 14, background: '#f5f9f6', cursor: 'not-allowed' }}
                    value={amount} onChange={e => setAmount(nonNegativeString(e.target.value))}
                    readOnly
                  />
                  {selected.dailyAmount && (
                    <div style={{ fontSize: 12.5, color: 'var(--mu)', textAlign: 'center', marginBottom: 8 }}>
                      Agreed contribution: ₦{selected.dailyAmount.toLocaleString()}/day
                    </div>
                  )}
                </>
              )}

              <div className="form-row fr2">
                <div><label className="flabel">Payment Method</label>
                  <select className="finput" value={method} onChange={e => setMethod(e.target.value)}>
                    <option>Cash</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="btn-row">
            <button className="btn btn-out" onClick={() => { setSelected(null); setQuery(''); setAmount(''); setNewPlan({ dailyAmount: '', periodDays: '90', goal: '', startDate: '', cadence: 'daily' }) }}>Cancel</button>
            {selected?.planStatus === 'Redeemed' ? (
              <button className="btn btn-g" disabled={loading} onClick={createPlan}>
                {loading ? '⏳ Creating…' : '📋 Create Savings Plan'}
              </button>
            ) : (
              <button className="btn btn-g" disabled={loading || !selected} onClick={requestPin}>
                {loading ? '⏳ Recording…' : '💰 Record Saving'}
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-title">Today&apos;s Savings</div>
            <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 28, fontWeight: 800, color: 'var(--g)', marginBottom: 4 }}>
              ₦{todayTotal.toLocaleString()}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--mu)', marginBottom: 16 }}>{todaySavings.length} transactions today</div>
            <div className="divider" />
            {todaySavings.map((s, i) => (
              <div key={i} className="cust-row" style={{ padding: '9px 0', borderBottom: i < todaySavings.length - 1 ? undefined : 'none' }}>
                <div className="av av-g">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                <div><div className="cust-name">{s.name}</div><div className="cust-sub">{s.time} · {s.method}</div></div>
                <div style={{ marginLeft: 'auto', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, color: 'var(--g)' }}>₦{s.amount.toLocaleString()}</div>
              </div>
            ))}
            {todaySavings.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 8 }}>No savings recorded today</div>
            )}
          </div>
        </div>
      </div>

      {/* No PIN Modal */}
      {noPinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 340, boxShadow: '0 8px 40px rgba(0,0,0,.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Transaction PIN Required</div>
            <div style={{ fontSize: 13.5, color: 'var(--mu)', marginBottom: 24, lineHeight: 1.6 }}>
              You haven&apos;t set up a transaction PIN yet. A PIN is required to record savings.
            </div>
            <a href="/dashboard/settings" className="btn btn-g" style={{ display: 'block', width: '100%', marginBottom: 10, textAlign: 'center', textDecoration: 'none' }}>
              Go to Settings to Set PIN
            </a>
            <button className="btn btn-out" style={{ width: '100%' }} onClick={() => setNoPinModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* PIN Modal */}
      {pinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 340, boxShadow: '0 8px 40px rgba(0,0,0,.2)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Enter Transaction PIN</div>
              <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 4 }}>
                {bulkMode
                  ? `₦${((selected?.dailyAmount ?? 0) * selectedDates.length).toLocaleString()} (${selectedDates.length} days) → ${selected?.firstName} ${selected?.lastName}`
                  : `₦${parseFloat(amount || '0').toLocaleString()} → ${selected?.firstName} ${selected?.lastName}`}
              </div>
            </div>
            <input
              className="finput"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••"
              autoFocus
              value={pinEntry}
              onChange={e => { setPinEntry(e.target.value.replace(/\D/g, '')); setPinError('') }}
              onKeyDown={e => e.key === 'Enter' && confirmPin()}
              style={{ textAlign: 'center', fontSize: 28, letterSpacing: 8, fontWeight: 700, marginBottom: 10 }}
            />
            {pinError && <div style={{ color: '#c0392b', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>⚠️ {pinError}</div>}
            <button className="btn btn-g" style={{ width: '100%', marginBottom: 10 }} disabled={pinVerifying || !pinEntry} onClick={confirmPin}>
              {pinVerifying ? '⏳ Verifying…' : 'Confirm'}
            </button>
            <button className="btn btn-out" style={{ width: '100%' }} onClick={() => setPinModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
