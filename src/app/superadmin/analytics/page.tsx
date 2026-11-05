'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCountUp } from '@/components/ui/Amount'
import { Empty, LoadError, PageHeader, Segmented, naira } from '../_components/admin-ui'
import type { buildAnalytics } from '@/lib/analytics'

// Blocks the actor may not see are absent from the response.
type Full = ReturnType<typeof buildAnalytics>
type Analytics = Pick<Full, 'days' | 'bucketDays' | 'buckets'> & Partial<Pick<Full, 'deposits' | 'savers' | 'plansBySource' | 'out' | 'earnings' | 'topAgents' | 'idleAgents' | 'loans' | 'growth'>>
type Range = '7' | '30' | '90'

const chartLoading = () => <div className="skel" style={{ height: 240 }} />
const DepositsBars = dynamic(() => import('../_components/AnalyticsCharts').then(m => m.DepositsBars), { ssr: false, loading: chartLoading })
const GrowthBars = dynamic(() => import('../_components/AnalyticsCharts').then(m => m.GrowthBars), { ssr: false, loading: chartLoading })

/** `neutral` for figures where more isn't simply good or bad (money going out): shown grey, not green or red. */
function change(total: number, prev: number, neutral = false): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (prev <= 0) return total > 0 ? { text: 'Nothing in the period before', tone: neutral ? 'flat' : 'up' } : null
  const pct = Math.round(((total - prev) / prev) * 100)
  if (pct === 0) return { text: 'Same as before', tone: 'flat' }
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs before`, tone: neutral ? 'flat' : pct > 0 ? 'up' : 'down' }
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })

/** Counts up to the true figure once (instantly under reduced motion); screen readers get the final figure. */
function Num({ value, money, suffix = '' }: { value: number; money?: boolean; suffix?: string }) {
  const shown = useCountUp(value, true)
  const f = (n: number) => (money ? naira(n) : Math.round(n).toLocaleString('en-NG')) + suffix
  return <><span className="sr-only">{f(value)}</span><span aria-hidden="true">{f(shown)}</span></>
}

/** One horizontal bar, drawn in by a width transition; used to set money in beside money out. */
function FlowBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'in' | 'out' }) {
  const [w, setW] = useState(0)
  useEffect(() => { const id = requestAnimationFrame(() => setW(max > 0 ? Math.max(2, (value / max) * 100) : 0)); return () => cancelAnimationFrame(id) }, [value, max])
  return (
    <div className="an-flow">
      <div className="an-bar-hd"><span className="an-bar-name">{label}</span><span className="an-bar-val">{naira(value)}</span></div>
      <div className="an-track"><div className={`an-fill is-${tone}`} style={{ width: `${w}%` }} /></div>
    </div>
  )
}

function Stat({ label, value, money, sub, chg }: { label: string; value: number; money?: boolean; sub?: string; chg?: ReturnType<typeof change> }) {
  return (
    <div className="stat">
      <div className="stat-lbl">{label}</div>
      <div className="stat-val"><Num value={value} money={money} /></div>
      {sub && <div className="stat-sub">{sub}</div>}
      {chg && <div className={`dep-chg is-${chg.tone}`}>{chg.text}</div>}
    </div>
  )
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('30')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [denied, setDenied] = useState(false)

  const load = useCallback(async (r: Range) => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/analytics?days=${r}`)
      if (res.status === 403) { setDenied(true); return }
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(range) }, [range, load])

  const weekly = (data?.bucketDays ?? 1) > 1
  const period = range === '7' ? 'the last 7 days' : range === '30' ? 'the last 30 days' : 'the last 90 days'

  return (
    <>
      <PageHeader title="Analytics" sub="Is the platform doing well? Money in, how people are saving, and growth."
        actions={<Segmented label="Time range" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />} />

      {denied ? <div className="card"><Empty icon="error" title="You don’t have access to this page" text="Ask a super admin to give your role access to one of the screens it summarises." /></div>
        : failed ? <div className="card"><LoadError what="analytics" onRetry={() => load(range)} /></div>
        : !data ? (
          <div aria-busy="true">
            <div className="stats-grid">{[0, 1, 2, 3].map(i => <div key={i} className="stat"><div className="skel" style={{ height: 64 }} /></div>)}</div>
            <div className="card"><div className="skel" style={{ height: 260 }} /></div>
          </div>
        ) : (
          <div key={range} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }} aria-busy={loading}>
            {data.earnings && (
              <>
                <h2 className="an-h">What the platform keeps</h2>
                <div className="stats-grid">
                  <Stat label="Platform keeps" money value={data.earnings.platform} chg={change(data.earnings.platform, data.earnings.platformPrev)} sub="Its own share only" />
                  <Stat label="From savings fees" money value={data.earnings.savingsFees} sub="Fees on deposits and collections" />
                  <Stat label="From loan interest" money value={data.earnings.loanShare} sub="Platform’s part of interest" />
                  <Stat label="Paid to agents" money value={data.earnings.agents} sub="Their commission, not counted above" />
                </div>
              </>
            )}

            {data.deposits && data.savers && (
              <>
                <h2 className="an-h">Money in</h2>
                <div className="stats-grid">
                  <Stat label="Deposited" money value={data.deposits.total} chg={change(data.deposits.total, data.deposits.prevTotal)} sub={data.deposits.fees > 0 ? `${naira(data.deposits.fees)} of it was fees` : 'Full amount paid in'} />
                  <Stat label="Deposits made" value={data.deposits.count} chg={change(data.deposits.count, data.deposits.prevCount)} sub="Completed savings" />
                  <Stat label="Average deposit" money value={data.deposits.average} sub="Per deposit" />
                  <Stat label="Saving this period" value={data.savers.active} sub={`Customers who deposited in ${period}`} />
                </div>
                <section className="card ov-row" aria-labelledby="an-dep">
                  <div className="card-hd"><h3 id="an-dep">Deposits {weekly ? 'per week' : 'per day'}</h3><Link href="/superadmin/transactions" className="card-link">See all</Link></div>
                  {data.deposits.count === 0 ? <Empty icon="history" title="No deposits in this period" text="Deposits appear here as agents and customers save." /> : <DepositsBars data={data.buckets} weekly={weekly} />}
                  <p className="dep-note">Full amounts customers paid in, before fees. “Before” means the {range} days just before this period.</p>
                </section>
              </>
            )}

            {data.out && data.deposits && (
              <>
                <h2 className="an-h">Money out</h2>
                <div className="stats-grid">
                  <Stat label="Paid out" money value={data.out.total} chg={change(data.out.total, data.out.prevTotal, true)} sub="Everything that left the platform" />
                  <Stat label="Savings paid back" money value={data.out.redemptions} sub="Redemptions to customers" />
                  <Stat label="Agent withdrawals" money value={data.out.withdrawals} sub="Approved commission payouts" />
                  <Stat label="Loans given" money value={data.out.loans} sub="Principal disbursed" />
                </div>
                <section className="card ov-row" aria-labelledby="an-flow">
                  <div className="card-hd"><h3 id="an-flow">In against out</h3></div>
                  <FlowBar label="Money in" value={data.deposits.total} max={Math.max(data.deposits.total, data.out.total)} tone="in" />
                  <FlowBar label="Money out" value={data.out.total} max={Math.max(data.deposits.total, data.out.total)} tone="out" />
                  <p className="an-net">{data.out.net >= 0 ? 'More came in than went out by ' : 'More went out than came in by '}<strong>{naira(Math.abs(data.out.net))}</strong> in {period}.</p>
                </section>
              </>
            )}

            {data.savers && data.plansBySource && (
              <>
                <h2 className="an-h">How people are saving</h2>
                <div className="stats-grid an-three">
                  <Stat label="Active plans" value={data.savers.activePlans} sub={`${data.plansBySource.agent} with an agent · ${data.plansBySource.self} self-service`} />
                  <Stat label="Gone quiet" value={data.savers.quiet} sub={`Active plans with no deposit for ${data.savers.quietDays} days`} />
                  <Stat label="Plans on track" value={Math.max(0, data.savers.activePlans - data.savers.quiet)} sub="Active and saving recently" />
                </div>
              </>
            )}

            {data.topAgents && data.idleAgents && (
              <>
                <h2 className="an-h">Agents</h2>
                <div className="g2 ov-row">
                  <section className="card" aria-labelledby="an-top">
                    <div className="card-hd"><h3 id="an-top">Top agents by deposits</h3><Link href="/superadmin/agents" className="card-link">All agents</Link></div>
                    {data.topAgents.length === 0 ? <Empty icon="customers" title="No agent deposits in this period" /> : (
                      <ol className="an-bars">
                        {data.topAgents.map(a => (
                          <li key={a.code}>
                            <div className="an-bar-hd"><span className="an-bar-name">{a.name}</span><span className="an-bar-val">{naira(a.total)}</span></div>
                            <div className="an-track"><div className="an-fill" style={{ width: `${Math.max(a.share, 2)}%` }} /></div>
                            <div className="an-bar-sub">{a.count} deposit{a.count === 1 ? '' : 's'} · {a.share}% of all deposits</div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                  <section className="card" aria-labelledby="an-idle">
                    <div className="card-hd"><h3 id="an-idle">No activity for {data.idleAgents.days} days</h3></div>
                    {data.idleAgents.of > 0 && <p className="an-lead"><strong>{data.idleAgents.count}</strong> of {data.idleAgents.of} agents who joined over a week ago haven’t recorded a deposit.</p>}
                    {data.idleAgents.count === 0 ? <Empty icon="customers" title={data.idleAgents.of === 0 ? 'No agents to check yet' : 'Every agent has been active'} text={data.idleAgents.of === 0 ? 'Agents show here a week after they join.' : undefined} /> : (
                      <ul className="an-list">
                        {data.idleAgents.list.map(a => (
                          <li key={a.code}><span>{a.name}</span><span className="an-bar-sub">{a.lastDeposit ? `Last deposit ${day(a.lastDeposit)}` : 'No recent deposits'}</span></li>
                        ))}
                        {data.idleAgents.count > data.idleAgents.list.length && <li className="an-bar-sub">and {data.idleAgents.count - data.idleAgents.list.length} more</li>}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}

            {data.loans && (
              <>
                <h2 className="an-h">Loans <span className="an-h-note">all time, not just this period</span></h2>
                <div className="stats-grid">
                  <Stat label="Still owed" money value={data.loans.outstanding} sub={`On ${naira(data.loans.principalOut)} lent out`} />
                  <Stat label="Late" money value={data.loans.overdue} sub={data.loans.overdueCount > 0 ? `${data.loans.overdueCount} loan${data.loans.overdueCount === 1 ? '' : 's'} past the due date` : 'Nothing past its due date'} />
                  <Stat label="Waiting for a decision" value={data.loans.pending} sub="Loan requests" />
                  <div className="stat">
                    <div className="stat-lbl">Paid back so far</div>
                    <div className="stat-val">{data.loans.repaidPct === null ? '—' : <Num value={data.loans.repaidPct} suffix="%" />}</div>
                    <div className="an-track an-prog" role="img" aria-label={`${data.loans.repaidPct ?? 0} percent of what is due has been repaid`}><div className="an-fill" style={{ width: `${data.loans.repaidPct ?? 0}%` }} /></div>
                    <div className="stat-sub">{data.loans.repaidPct === null ? 'No loans given yet' : `${naira(data.loans.totalRepaid)} of ${naira(data.loans.totalDue)} due`}</div>
                  </div>
                </div>
              </>
            )}

            {data.growth && (
              <>
                <h2 className="an-h">Growth</h2>
                <div className="stats-grid an-two">
                  <Stat label="New customers" value={data.growth.newCustomers} sub={`Joined in ${period}`} />
                  <Stat label="New agents" value={data.growth.newAgents} sub={`Joined in ${period}`} />
                </div>
                <section className="card ov-row" aria-labelledby="an-grow">
                  <div className="card-hd"><h3 id="an-grow">Sign-ups {weekly ? 'per week' : 'per day'}</h3></div>
                  {data.growth.newCustomers + data.growth.newAgents === 0 ? <Empty icon="customers" title="No sign-ups in this period" /> : <GrowthBars data={data.buckets} weekly={weekly} />}
                </section>
              </>
            )}
          </div>
        )}
    </>
  )
}
