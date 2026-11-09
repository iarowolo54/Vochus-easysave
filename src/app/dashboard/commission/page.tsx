'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Bone, ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { displayName, formatDate, formatNaira } from '@/lib/format'

interface Commission {
  id: string; month: number; year: number; amount: number; breakdown: string | null; createdAt: string
}

interface Reward {
  id: string; type: string; amount: number; narration: string; createdAt: string
  customer: { firstName: string; lastName: string; customerId: string }
}

interface Breakdown {
  savings?: { count: number; volume: number; commission?: number }
  redemptions?: { count: number; volume: number; commission?: number }
  enrolments?: { count: number }
  rewards?: { customerId: string; customerName: string; amount: number; type: string }[]
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parseBreakdown(s: string | null): Breakdown | null {
  if (!s) return null
  try { return JSON.parse(s) as Breakdown } catch { return null }
}

export default function CommissionPage() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/commission').then(r => r.json()).then(d => {
      setCommissions(d.commissions ?? [])
      setRewards(d.rewards ?? [])
    }).catch(() => setFailed(true)).finally(() => setLoading(false))
  }, [])

  const current = commissions[0]
  const breakdown = parseBreakdown(current?.breakdown ?? null)
  const txCount = breakdown ? (breakdown.savings?.count ?? 0) + (breakdown.redemptions?.count ?? 0) + (breakdown.enrolments?.count ?? 0) : 0
  const volume = breakdown ? (breakdown.savings?.volume ?? 0) + (breakdown.redemptions?.volume ?? 0) : 0
  const trend = commissions.slice(0, 6).reverse()
  const maxAmt = Math.max(...trend.map(c => c.amount), 1)

  if (loading) {
    return (
      <div className="ag-page ui-skeleton" aria-hidden="true">
        <div className="ui-card ag-earn"><Bone w="30%" /><div style={{ height: 10 }} /><Bone w="50%" h={40} /><div style={{ height: 10 }} /><Bone w="40%" /></div>
        <ListSkeleton count={4} />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="ag-page">
        <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your commission" text="Check your connection and refresh the page." /></section>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="ag-page">
        <section className="ui-card">
          <EmptyState icon="commission" title="No commission yet" text="What you earn from redemptions, loans and rewards will show here each month." />
        </section>
      </div>
    )
  }

  return (
    <div className="ag-page">
      <div className="ag-home-grid">
        <div className="ag-col">
          <section className="ui-card ag-earn" aria-label="This month">
            <span className="ui-row-sub">Earned in {MONTHS[current.month]} {current.year}</span>
            <p className="ag-earn-amount">{formatNaira(current.amount)}</p>
            {breakdown && <p className="ui-row-sub">From {txCount} transaction{txCount === 1 ? '' : 's'} · {formatNaira(volume, { minor: false })} handled</p>}
            <Link href="/dashboard/withdraw" className="ui-btn ui-btn--primary ag-earn-btn"><Icons.withdraw size={18} aria-hidden="true" /> Withdraw commission</Link>
          </section>

          {breakdown && (
            <>
              <div className="ui-section-head"><h2>How you earned it</h2></div>
              <section className="ui-card ui-card--list" aria-label="Breakdown">
                {breakdown.savings && (
                  <ListRow icon="deposit" title="Savings" sub={`${breakdown.savings.count} · ${formatNaira(breakdown.savings.volume ?? 0, { minor: false })}`}
                    value={<span className="ui-value-stack">{formatNaira(breakdown.savings.commission ?? 0)}</span>} />
                )}
                {breakdown.redemptions && (
                  <ListRow icon="withdraw" title="Redemptions" sub={`${breakdown.redemptions.count} · ${formatNaira(breakdown.redemptions.volume ?? 0, { minor: false })}`}
                    value={<span className="ui-value-stack ui-amount--positive">{formatNaira(breakdown.redemptions.commission ?? 0)}</span>} />
                )}
                {breakdown.enrolments && (
                  <ListRow icon="enrol" title="Enrolments" sub={`${breakdown.enrolments.count} new customer${breakdown.enrolments.count === 1 ? '' : 's'}`}
                    value={<span className="ui-value-stack">{formatNaira(0)}</span>} />
                )}
                {breakdown.rewards?.map(r => (
                  <ListRow key={r.customerId} icon="commission" title={`Reward · ${displayName(r.customerName)}`} sub={r.type === 'online' ? 'Online sign-up' : 'Enrolled by you'}
                    value={<span className="ui-value-stack ui-amount--positive">{formatNaira(r.amount)}</span>} />
                ))}
                <div className="ui-row ag-earn-total">
                  <span className="ui-row-main"><span className="ui-row-title">Total for {MONTHS[current.month]}</span></span>
                  <span className="ui-row-value">{formatNaira(current.amount)}</span>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="ag-col">
          {trend.length > 1 && (
            <>
              <div className="ui-section-head"><h2>Last {trend.length} months</h2></div>
              <section className="ui-card" aria-label="Commission per month">
                <ol className="ag-bars">
                  {trend.map((c, i) => {
                    const isCurrent = i === trend.length - 1
                    return (
                      <li key={c.id} className={isCurrent ? 'is-current' : undefined}>
                        <span className="ag-bar-value">{c.amount >= 1000 ? `₦${(c.amount / 1000).toFixed(1)}k` : formatNaira(c.amount, { minor: false })}</span>
                        <span className="ag-bar-track"><span className="ag-bar" style={{ height: `${Math.max(4, Math.round((c.amount / maxAmt) * 100))}%` }} /></span>
                        <span className="ag-bar-label">{MONTHS[c.month].slice(0, 3)}</span>
                      </li>
                    )
                  })}
                </ol>
              </section>
            </>
          )}

          {commissions.length > 1 && (
            <>
              <div className="ui-section-head"><h2>Earlier months</h2></div>
              <section className="ui-card ui-card--list">
                {commissions.slice(1).map(c => (
                  <ListRow key={c.id} icon="calendar" title={`${MONTHS[c.month]} ${c.year}`} value={<span className="ui-value-stack">{formatNaira(c.amount)}</span>} />
                ))}
              </section>
            </>
          )}

          {rewards.length > 0 && (
            <>
              <div className="ui-section-head"><h2>Sign-up rewards</h2></div>
              <section className="ui-card ui-card--list">
                {rewards.map(r => (
                  <ListRow key={r.id} icon={r.type === 'online' ? 'share' : 'enrol'}
                    title={displayName(`${r.customer.firstName} ${r.customer.lastName}`)}
                    sub={`${r.customer.customerId} · ${formatDate(r.createdAt)} · ${r.type === 'online' ? 'Online' : 'In person'}`}
                    value={<span className="ui-value-stack ui-amount--positive">+{formatNaira(r.amount, { minor: false })}</span>} />
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
