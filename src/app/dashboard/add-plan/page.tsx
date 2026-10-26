'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string; phone: string
  savingsBalance: number; savingsPlans: any[]
}

export default function AddPlanPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Loading…</div>}>
      <AddPlanContent />
    </Suspense>
  )
}

function AddPlanContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [dailyAmount, setDailyAmount] = useState('')
  const [periodDays, setPeriodDays] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState('')
  const [notes, setNotes] = useState('')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid) { setLoading(false); setError('No customer specified'); return }
    fetch(`/api/customers?search=${encodeURIComponent(cid)}&limit=1`)
      .then(r => r.json())
      .then(d => {
        const c = d.customers?.[0]
        if (!c) setError('Customer not found')
        else setCustomer(c)
        setLoading(false)
      })
      .catch(() => { setError('Could not load customer'); setLoading(false) })
  }, [searchParams])

  async function submit() {
    if (!customer) return
    setError('')
    if (!dailyAmount || !periodDays || !goal) { setError('Fill all required fields.'); return }
    if (!agreed) { setError('Customer must agree to the terms first.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/customers/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          dailyAmount: String(dailyEquiv),
          periodDays, goal, cadence,
          startDate: startDate || undefined,
          notes: notes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create plan'); setSaving(false); return }
      setSuccess(`New plan created for ${customer.firstName} ${customer.lastName}.`)
      setTimeout(() => router.push('/dashboard/customers'), 1500)
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Loading…</div>
  if (!customer) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ color: 'var(--rd)', marginBottom: 12 }}>{error || 'Customer not found'}</div>
      <button className="btn btn-out" onClick={() => router.push('/dashboard/customers')}>Back to customers</button>
    </div>
  )

  const isWeekly = cadence === 'weekly'
  const isMonthly = cadence === 'monthly'

  const rawAmt = parseFloat(dailyAmount) || 0
  const dailyEquiv = isWeekly ? rawAmt / 7 : isMonthly ? rawAmt / 30 : rawAmt
  const total = rawAmt && periodDays ? Math.round(dailyEquiv * parseInt(periodDays)) : 0
  const maturity = startDate && periodDays ? (() => {
    const d = new Date(startDate); d.setDate(d.getDate() + parseInt(periodDays))
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  })() : ''

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-out" onClick={() => router.back()} style={{ fontSize: 12 }}>← Back</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--gl)', color: 'var(--g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16 }}>
            {(customer.firstName[0] ?? '') + (customer.lastName[0] ?? '')}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{customer.firstName} {customer.lastName}</div>
            <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>{customer.customerId} · {customer.phone}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mu)', marginTop: 2 }}>
              {customer.savingsPlans.length} existing plan{customer.savingsPlans.length !== 1 ? 's' : ''} · Balance ₦{customer.savingsBalance.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">➕ Add New Savings Plan</div>

        {error && <div style={{ background: 'var(--rdl)', color: 'var(--rd)', padding: '10px 12px', borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ background: 'var(--gl)', color: 'var(--g)', padding: '10px 12px', borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{success}</div>}

        <div style={{ marginBottom: 12 }}>
          <label className="flabel">Saving Frequency *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setCadence('daily')} style={cadenceBtn(cadence === 'daily')}>📅 Daily</button>
            <button onClick={() => setCadence('weekly')} style={cadenceBtn(cadence === 'weekly')}>📆 Weekly</button>
            <button onClick={() => setCadence('monthly')} style={cadenceBtn(cadence === 'monthly')}>🗓️ Monthly</button>
          </div>
        </div>

        <div className="form-row fr2">
          <div>
            <label className="flabel">{isWeekly ? 'Weekly' : isMonthly ? 'Monthly' : 'Daily'} Saving Amount (₦) *</label>
            <input className="finput" type="tel" inputMode="decimal" placeholder={isWeekly ? '3500' : isMonthly ? '15000' : '500'} value={dailyAmount} onChange={e => setDailyAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <div>
            <label className="flabel">Saving Period {isWeekly ? '(Weeks)' : isMonthly ? '(Months)' : '(Days)'} *</label>
            <select className="finput" value={periodDays} onChange={e => setPeriodDays(e.target.value)}>
              <option value="">Select…</option>
              {isWeekly ? (
                <>
                  <option value="28">4 Weeks</option><option value="56">8 Weeks</option>
                  <option value="84">12 Weeks</option><option value="168">24 Weeks</option><option value="364">52 Weeks</option>
                </>
              ) : isMonthly ? (
                <>
                  <option value="30">1 Month</option><option value="60">2 Months</option>
                  <option value="90">3 Months</option><option value="180">6 Months</option><option value="365">12 Months</option>
                </>
              ) : (
                <>
                  <option value="31">31 Days</option><option value="62">62 Days</option>
                  <option value="93">93 Days</option><option value="186">186 Days</option><option value="365">365 Days</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="form-row fr2">
          <div>
            <label className="flabel">Saving Goal *</label>
            <select className="finput" value={goal} onChange={e => setGoal(e.target.value)}>
              <option value="">Select goal…</option>
              <option>School Fees</option><option>Business Capital</option><option>House Rent</option>
              <option>Medical Expenses</option><option>Wedding / Event</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="flabel">Start Date</label>
            <input className="finput" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
        </div>

        <label className="flabel">Notes (optional)</label>
        <input className="finput" placeholder="e.g. Second plan for wedding savings" value={notes} onChange={e => setNotes(e.target.value)} />

        {total > 0 && (() => {
          const deductionPreview = total > 0
            ? (isWeekly || isMonthly
              ? Math.round(total * 0.20 * 100) / 100
              : Math.round(dailyEquiv * (parseInt(periodDays) / 31) * 100) / 100)
            : 0
          return (
            <div style={{ background: 'var(--gl)', border: '1px solid var(--br)', borderRadius: 10, padding: 12, marginTop: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                <span style={{ color: 'var(--mu)' }}>Target at maturity</span>
                <strong style={{ color: 'var(--g)' }}>₦{total.toLocaleString()}</strong>
              </div>
              {deductionPreview > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                  <span style={{ color: 'var(--rd)' }}>Platform deduction at maturity</span>
                  <strong style={{ color: 'var(--rd)' }}>-₦{deductionPreview.toLocaleString()}</strong>
                </div>
              )}
              {maturity && (
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                  <span style={{ color: 'var(--mu)' }}>Matures on</span>
                  <strong>{maturity}</strong>
                </div>
              )}
            </div>
          )
        })()}

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }} onClick={() => setAgreed(!agreed)}>
          <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: `2px solid ${agreed ? 'var(--g)' : 'var(--br)'}`, background: agreed ? 'var(--g)' : 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {agreed && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
          </div>
          <label style={{ cursor: 'pointer' }}>Customer has verbally agreed to the terms of this new plan.</label>
        </div>

        <div className="btn-row" style={{ marginTop: 18 }}>
          <button className="btn btn-out" onClick={() => router.push('/dashboard/customers')} disabled={saving}>Cancel</button>
          <button className="btn btn-g" onClick={submit} disabled={saving || !agreed}>{saving ? 'Creating…' : '➕ Create Plan'}</button>
        </div>
      </div>
    </div>
  )
}

const cadenceBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8,
  border: `2px solid ${active ? 'var(--g)' : 'var(--br)'}`,
  background: active ? 'var(--gl)' : 'var(--card)',
  color: active ? 'var(--g)' : 'var(--txt)',
  fontWeight: 700, cursor: 'pointer', fontSize: 13,
})
