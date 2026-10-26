'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BottomNav from '@/components/BottomNav'
import { CUSTOMER_NAV } from '@/components/nav-items'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

const DAILY_DURATIONS = [
  { days: 31,  name: '31 Days',  desc: 'Short-term' },
  { days: 62,  name: '62 Days',  desc: 'Most popular', popular: true },
  { days: 93,  name: '93 Days',  desc: 'Medium-term' },
  { days: 186, name: '186 Days', desc: 'Long-term' },
  { days: 365, name: '365 Days', desc: 'Full year' },
]

const WEEKLY_DURATIONS = [
  { weeks: 4,  days: 28,  name: '4 Weeks',  desc: 'Short-term' },
  { weeks: 8,  days: 56,  name: '8 Weeks',  desc: 'Most popular', popular: true },
  { weeks: 12, days: 84,  name: '12 Weeks', desc: 'Medium-term' },
  { weeks: 24, days: 168, name: '24 Weeks', desc: 'Long-term' },
  { weeks: 52, days: 364, name: '52 Weeks', desc: 'Full year' },
]

const MONTHLY_DURATIONS = [
  { months: 1,  days: 30,  name: '1 Month',  desc: 'Short-term' },
  { months: 2,  days: 60,  name: '2 Months', desc: 'Most popular', popular: true },
  { months: 3,  days: 90,  name: '3 Months', desc: 'Medium-term' },
  { months: 6,  days: 180, name: '6 Months', desc: 'Long-term' },
  { months: 12, days: 365, name: '12 Months', desc: 'Full year' },
]

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string
}

function SavePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const paramPlanId = params.get('planId')
  const forceNew = params.get('new') === '1'

  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(paramPlanId)
  const [amount, setAmount] = useState('')
  const [pendingRedemption, setPendingRedemption] = useState<{ ref: string; status: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [showNewForm, setShowNewForm] = useState(forceNew)

  const [newDaily, setNewDaily] = useState('500')
  const [newPeriod, setNewPeriod] = useState(62)
  const [newGoal, setNewGoal] = useState('General Savings')
  const [creating, setCreating] = useState(false)
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')

  useEffect(() => {
    fetch('/api/customer/me')
      .then(r => { if (r.status === 401) { router.push('/customer/login'); return null } return r.json() })
      .then(d => {
        if (!d) return
        if (d.pendingRedemption) { setPendingRedemption(d.pendingRedemption); return }
        const allPlans: Plan[] = d.plans ?? (d.plan ? [d.plan] : [])
        setPlans(allPlans)
        if (!paramPlanId && allPlans.length > 0) {
          const plan = allPlans[0]
          setSelectedPlanId(plan.id)
          const displayAmount = plan.cadence === 'weekly' ? Math.round(plan.dailyAmount * 7) : plan.cadence === 'monthly' ? Math.round(plan.dailyAmount * 30) : Math.round(plan.dailyAmount)
          setAmount(String(displayAmount))
        } else if (paramPlanId) {
          const p = allPlans.find(x => x.id === paramPlanId)
          if (p) {
            const displayAmount = p.cadence === 'weekly' ? Math.round(p.dailyAmount * 7) : p.cadence === 'monthly' ? Math.round(p.dailyAmount * 30) : Math.round(p.dailyAmount)
            setAmount(String(displayAmount))
          }
        }
        if (forceNew || allPlans.length === 0) setShowNewForm(true)
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null

  function selectPlan(p: Plan) {
    setSelectedPlanId(p.id)
    const displayAmount = p.cadence === 'weekly' ? Math.round(p.dailyAmount * 7) : p.cadence === 'monthly' ? Math.round(p.dailyAmount * 30) : Math.round(p.dailyAmount)
    setAmount(String(displayAmount))
    setShowNewForm(false)
    setError('')
  }

  async function pay() {
    setError('')
    const amt = parseFloat(amount)
    const plan = selectedPlan
    const minAmt = plan ? Math.round(plan.cadence === 'weekly' ? plan.dailyAmount * 7 : plan.cadence === 'monthly' ? plan.dailyAmount * 30 : plan.dailyAmount) : 100
    const unit = plan?.cadence === 'weekly' ? 'weekly' : plan?.cadence === 'monthly' ? 'monthly' : 'daily'
    if (!amt || amt < minAmt) { setError(`Minimum amount is ₦${minAmt.toLocaleString()} (your ${unit} savings target)`); return }
    if (!selectedPlanId) { setError('Select a savings plan first'); return }
    setPaying(true)
    try {
      const res = await fetch('/api/customer/paystack/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, planId: selectedPlanId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to initiate payment'); return }
      window.location.href = data.authorizationUrl
    } catch { setError('Network error') }
    finally { setPaying(false) }
  }

  async function createPlan() {
    setError('')
    const rawAmt = parseFloat(newDaily)
    const dailyAmount = cadence === 'weekly' ? rawAmt / 7 : cadence === 'monthly' ? rawAmt / 30 : rawAmt
    if (!rawAmt || (cadence === 'weekly' ? rawAmt < 1000 : cadence === 'monthly' ? rawAmt < 3000 : rawAmt < 100)) { setError(cadence === 'weekly' ? 'Minimum ₦1000/week' : cadence === 'monthly' ? 'Minimum ₦3000/month' : 'Minimum ₦100/day'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/customer/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyAmount, periodDays: newPeriod, goal: newGoal, cadence }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create plan'); return }
      const newPlan: Plan = data.plan
      setPlans(prev => [newPlan, ...prev])
      setSelectedPlanId(newPlan.id)
      setAmount(String(newPlan.cadence === 'weekly' ? Math.round(newPlan.dailyAmount * 7) : newPlan.cadence === 'monthly' ? Math.round(newPlan.dailyAmount * 30) : Math.round(newPlan.dailyAmount)))
      setShowNewForm(false)
    } catch { setError('Network error') }
    finally { setCreating(false) }
  }

  const rawAmt = parseFloat(newDaily || '0')
  const dailyEquiv = cadence === 'weekly' ? rawAmt / 7 : cadence === 'monthly' ? rawAmt / 30 : rawAmt
  const gross = Math.round(dailyEquiv * newPeriod)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--gl)', borderTop: '3px solid var(--g)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (pendingRedemption) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{ position: 'sticky', top: 0, height: 56, zIndex: 200, background: 'linear-gradient(135deg,#071a0e,#0e4d24)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
        <button onClick={() => router.push('/customer/dashboard')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}>←</button>
        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Make a Saving</div>
      </div>
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 60, marginBottom: 16 }}>🔒</div>
        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Savings Locked</div>
        <div style={{ fontSize: 13.5, color: 'var(--mu)', lineHeight: 1.7, marginBottom: 24 }}>
          You have a pending redemption request. New savings are not allowed while a redemption is being processed. Please resolve your redemption first.
        </div>
        <button onClick={() => router.push('/customer/redeem')} style={{
          width: '100%', padding: 14, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
          border: 'none', borderRadius: 13, cursor: 'pointer',
          fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: 800, color: '#fff',
        }}>View Redemption Request →</button>
        <button onClick={() => router.push('/customer/dashboard')} style={{ width: '100%', marginTop: 10, padding: 13, background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{
        position: 'sticky', top: 0, height: 56, zIndex: 200,
        background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button onClick={() => router.push('/customer/dashboard')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}>←</button>
        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>
          {showNewForm ? 'New Savings Plan' : 'Make a Saving'}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {error && <div style={{ background: 'var(--rdl)', color: 'var(--rd)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {/* Plan selector (only when not in new-plan form) */}
        {!showNewForm && plans.length > 0 && (
          <>
            {plans.length > 1 && (
              <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Select Savings Plan</div>
                {plans.map(p => {
                  const pct = Math.min(100, Math.round((p.balance / (p.dailyAmount * p.periodDays)) * 100))
                  const active = p.id === selectedPlanId
                  return (
                    <div key={p.id} onClick={() => selectPlan(p)} style={{
                      border: `2px solid ${active ? 'var(--g)' : 'var(--br)'}`,
                      borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                      background: active ? 'var(--gl)' : 'var(--card)', marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? 'var(--g)' : 'var(--txt)' }}>{p.goal}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--mu)', marginTop: 2 }}>
                            {p.cadence === 'weekly'
                              ? `₦${(p.dailyAmount * 7).toLocaleString()}/week · ${p.periodDays / 7} weeks`
                              : p.cadence === 'monthly'
                              ? `₦${Math.round(p.dailyAmount * 30).toLocaleString()}/month · ${Math.round(p.periodDays / 30)} months`
                              : `₦${p.dailyAmount.toLocaleString()}/day · ${p.periodDays} days`
                            }
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 900, color: 'var(--g)' }}>₦{p.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: 'var(--mu)' }}>{pct}% complete</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {selectedPlan && (
              <>
                <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 16, padding: 18, textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 4 }}>Current Balance · {selectedPlan.goal}</div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 32, fontWeight: 900, color: '#fff' }}>₦{selectedPlan.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
                    ₦{selectedPlan.cadence === 'weekly' ? (selectedPlan.dailyAmount * 7).toLocaleString() : selectedPlan.cadence === 'monthly' ? Math.round(selectedPlan.dailyAmount * 30).toLocaleString() : selectedPlan.dailyAmount.toLocaleString()}/{selectedPlan.cadence === 'weekly' ? 'week' : selectedPlan.cadence === 'monthly' ? 'month' : 'day'} recommended
                  </div>
                </div>

                <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>💳 Pay via Paystack</div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }}>Amount (₦)</label>
                  <input
                    value={amount} readOnly
                    type="tel"
                    style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', fontFamily: 'Plus Jakarta Sans', padding: 16, cursor: 'default', caretColor: 'transparent' }}
                  />
                  <button onClick={pay} disabled={paying} style={{
                    width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
                    border: 'none', borderRadius: 13, cursor: 'pointer',
                    fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
                    boxShadow: '0 6px 20px rgba(26,107,58,.35)', opacity: paying ? .6 : 1,
                  }}>{paying ? 'Redirecting to Paystack…' : '💳 Pay Now with Paystack'}</button>
                </div>

                <div style={{ background: 'var(--gl)', border: '1px solid var(--gm)', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: 'var(--g)', marginBottom: 14 }}>
                  ℹ️ Platform fee will be taken after maturity
                </div>
              </>
            )}

            <button onClick={() => { setShowNewForm(true); setError('') }} style={{
              width: '100%', padding: 12, background: 'var(--card)',
              border: '1.5px dashed var(--gm)', borderRadius: 13, cursor: 'pointer',
              fontSize: 13.5, fontWeight: 700, color: 'var(--g)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>➕ Start New Savings Plan</button>
          </>
        )}

        {/* New plan form */}
        {showNewForm && (
          <>
            {plans.length > 0 && (
              <button onClick={() => { setShowNewForm(false); setError('') }} style={{
                background: 'none', border: 'none', color: 'var(--g)', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6,
              }}>← Back to existing plans</button>
            )}

            <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>💰 {cadence === 'weekly' ? 'Weekly' : cadence === 'monthly' ? 'Monthly' : 'Daily'} Savings Amount (₦)</div>
              <input
                value={newDaily} onChange={e => setNewDaily(nonNegativeString(e.target.value))} onKeyDown={blockMinus}
                type="tel" inputMode="decimal" placeholder={cadence === 'weekly' ? '1000' : cadence === 'monthly' ? '3000' : '500'}
                style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', fontFamily: 'Plus Jakarta Sans', padding: 16 }}
              />
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--mu)', marginTop: -8, marginBottom: 8 }}>Naira per {cadence === 'weekly' ? 'week' : cadence === 'monthly' ? 'month' : 'day'}</div>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
              {/* Header with Daily/Weekly toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>📅 Plan Duration</div>
                <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 20, padding: 3, border: '1px solid var(--br)' }}>
                  {(['daily', 'weekly', 'monthly'] as const).map(c => (
                    <button key={c} onClick={() => {
                      setCadence(c)
                      setNewPeriod(c === 'daily' ? 62 : c === 'weekly' ? 56 : 60)
                    }} style={{
                      padding: '5px 13px', borderRadius: 16, border: 'none', cursor: 'pointer',
                      fontSize: 11.5, fontWeight: 700,
                      background: cadence === c ? 'var(--g)' : 'transparent',
                      color: cadence === c ? '#fff' : 'var(--mu)',
                      transition: 'all .15s',
                    }}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {(cadence === 'daily' ? DAILY_DURATIONS : cadence === 'weekly' ? WEEKLY_DURATIONS : MONTHLY_DURATIONS).map(p => (
                <div key={p.days} onClick={() => setNewPeriod(p.days)} style={{
                  border: `2px solid ${p.days === newPeriod ? 'var(--g)' : 'var(--br)'}`,
                  borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
                  background: p.days === newPeriod ? 'var(--gl)' : 'var(--card)',
                }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${p.days === newPeriod ? 'var(--g)' : 'var(--br)'}`, background: p.days === newPeriod ? 'var(--g)' : 'var(--card)', position: 'relative', flexShrink: 0 }}>
                    {p.days === newPeriod && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.name}{p.popular ? ' ⭐' : ''}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{p.desc}</div>
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 16, fontWeight: 900, color: 'var(--g)' }}>
                    ₦{Math.round(dailyEquiv * p.days).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>🎯 Savings Goal</div>
              <select value={newGoal} onChange={e => setNewGoal(e.target.value)} style={{ fontSize: 14, marginBottom: 0 }}>
                <option>General Savings</option>
                <option>School Fees</option>
                <option>Business Capital</option>
                <option>House Rent / Building</option>
                <option>Medical Expenses</option>
                <option>Wedding / Event</option>
                <option>Farm / Agriculture</option>
              </select>
            </div>

            {parseFloat(newDaily) > 0 && (
              <>
                <div style={{ background: 'var(--gl)', border: '1px solid var(--gm)', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: 'var(--g)', marginBottom: 14 }}>
                  ℹ️ Platform fee will be taken after maturity
                </div>
                <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 14, padding: 16, textAlign: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 4 }}>Total You&apos;ll Save</div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 32, fontWeight: 900, color: '#fff' }}>₦{gross.toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
                    ₦{rawAmt.toLocaleString()}/{cadence === 'weekly' ? 'week' : cadence === 'monthly' ? 'month' : 'day'} × {cadence === 'weekly' ? newPeriod / 7 + ' weeks' : cadence === 'monthly' ? Math.round(newPeriod / 30) + ' months' : newPeriod + ' days'}
                  </div>
                </div>
              </>
            )}

            <button onClick={createPlan} disabled={creating} style={{
              width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
              border: 'none', borderRadius: 13, cursor: 'pointer',
              fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
              boxShadow: '0 6px 20px rgba(26,107,58,.35)', opacity: creating ? .6 : 1,
            }}>{creating ? 'Creating Plan…' : '🚀 Start Saving Now'}</button>
          </>
        )}
      </div>

      <BottomNav items={CUSTOMER_NAV} />
    </div>
  )
}

export default function CustomerSavePage() {
  return (
    <Suspense>
      <SavePageInner />
    </Suspense>
  )
}
