'use client'

import { useState, useEffect } from 'react'

interface Commission {
  id: string; month: number; year: number; amount: number; breakdown: string | null; createdAt: string
}

interface Reward {
  id: string; type: string; amount: number; narration: string; createdAt: string
  customer: { firstName: string; lastName: string; customerId: string }
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(s: string) { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

export default function CommissionPage() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/commission').then(r => r.json()).then(d => {
      setCommissions(d.commissions ?? [])
      setRewards(d.rewards ?? [])
      setLoading(false)
    })
  }, [])

  const current = commissions[0]
  const breakdown = current?.breakdown ? JSON.parse(current.breakdown) : null
  const maxAmt = Math.max(...commissions.map(c => c.amount), 1)

  return (
    <>
      <div className="page-header">
        <h2>Commission Statement</h2>
        <p>Your earnings and payout history</p>
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 24 }}>Loading…</div>}

      {!loading && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <div className="stat-card gold">
              <div className="stat-icon" style={{ background: 'var(--gdl)' }}>🏅</div>
              <div className="stat-lbl">Earned This Month</div>
              <div className="stat-val">₦{(current?.amount ?? 0).toLocaleString()}</div>
              <div className="stat-sub">Current period</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-icon" style={{ background: 'var(--bl)' }}>📊</div>
              <div className="stat-lbl">Transactions</div>
              <div className="stat-val">{breakdown ? (breakdown.savings?.count ?? 0) + (breakdown.redemptions?.count ?? 0) + (breakdown.enrolments?.count ?? 0) : '—'}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon" style={{ background: 'var(--gl)' }}>💰</div>
              <div className="stat-lbl">Volume</div>
              <div className="stat-val">₦{breakdown ? ((breakdown.savings?.volume ?? 0) + (breakdown.redemptions?.volume ?? 0)).toLocaleString() : '—'}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon" style={{ background: 'var(--gl)' }}>📈</div>
              <div className="stat-lbl">Commission Rate</div>
              <div className="stat-val">0.4%</div>
            </div>
          </div>

          <div className="grid g-2-1">
            <div>
              {current && breakdown && (
                <div className="card" style={{ marginBottom: 18 }}>
                  <div className="card-title">Breakdown — {MONTHS[current.month]} {current.year}</div>
                  <div className="table-wrap"><table>
                    <thead><tr><th>Category</th><th>Transactions</th><th>Volume</th><th>Commission</th><th>Rate</th></tr></thead>
                    <tbody>
                      {breakdown.savings && (
                        <tr>
                          <td>💰 Savings</td>
                          <td>{breakdown.savings.count}</td>
                          <td>₦{(breakdown.savings.volume ?? 0).toLocaleString()}</td>
                          <td className="td-mono" style={{ color: 'var(--mu)' }}>₦0</td>
                          <td>—</td>
                        </tr>
                      )}
                      {breakdown.redemptions && (
                        <tr>
                          <td>🎯 Redemptions</td>
                          <td>{breakdown.redemptions.count}</td>
                          <td>₦{(breakdown.redemptions.volume ?? 0).toLocaleString()}</td>
                          <td className="td-mono" style={{ color: 'var(--g)' }}>₦{(breakdown.redemptions.commission ?? 0).toLocaleString()}</td>
                          <td>—</td>
                        </tr>
                      )}
                      {breakdown.enrolments && (
                        <tr>
                          <td>📋 Enrolments</td>
                          <td>{breakdown.enrolments.count}</td>
                          <td>—</td>
                          <td className="td-mono" style={{ color: 'var(--mu)' }}>₦0</td>
                          <td>—</td>
                        </tr>
                      )}
                      {breakdown.rewards && breakdown.rewards.map((r: any) => (
                        <tr key={r.customerId}>
                          <td>🎁 Reward — {r.customerName}</td>
                          <td>1</td>
                          <td>—</td>
                          <td className="td-mono" style={{ color: 'var(--g)' }}>₦{r.amount.toLocaleString()}</td>
                          <td style={{ fontSize: 11, color: 'var(--mu)' }}>{r.type}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700, background: 'var(--gl)' }}>
                        <td>Total</td>
                        <td>—</td>
                        <td>—</td>
                        <td className="td-mono" style={{ color: 'var(--g)', fontSize: 15 }}>₦{current.amount.toLocaleString()}</td>
                        <td>—</td>
                      </tr>
                    </tbody>
                  </table></div>
                </div>
              )}
              <div className="card">
                <div className="card-title">Previous Payouts</div>
                {commissions.slice(1).map((c, i) => (
                  <div key={c.id} className="cust-row" style={{ padding: '9px 0', borderBottom: i < commissions.length - 2 ? undefined : 'none' }}>
                    <div className="av av-gd">💵</div>
                    <div><div className="cust-name">{MONTHS[c.month]} Commission</div><div className="cust-sub">{c.year}</div></div>
                    <div style={{ marginLeft: 'auto', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, color: 'var(--gd)' }}>₦{c.amount.toLocaleString()}</div>
                  </div>
                ))}
                {commissions.length <= 1 && (
                  <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 8 }}>No previous payouts</div>
                )}
              </div>
            </div>
            <div>
              {commissions.length > 1 && (
                <div className="card" style={{ marginBottom: 18 }}>
                  <div className="card-title">Monthly Trend</div>
                  <div className="bar-chart" style={{ height: 100 }}>
                    {commissions.slice(0, 6).reverse().map((c, i, arr) => (
                      <div key={c.id} className="bar-col">
                        <div className={`bar${i === arr.length - 1 ? ' active' : ''}`} style={{ height: `${Math.round((c.amount / maxAmt) * 100)}%` }} />
                        <div className="bar-lbl" style={i === arr.length - 1 ? { color: 'var(--g)', fontWeight: 700 } : {}}>
                          {MONTHS[c.month].slice(0, 3)}<br />
                          <span style={{ color: 'var(--mu)' }}>₦{(c.amount / 1000).toFixed(1)}K</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {current && (
                <div className="card" style={{ marginBottom: 18 }}>
                  <div className="card-title">Current Period</div>
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Commission for {MONTHS[current.month]} {current.year}
                    </div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 36, fontWeight: 800, color: 'var(--gd)', margin: '8px 0' }}>
                      ₦{current.amount.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>Next payout: 1st of next month</div>
                  </div>
                </div>
              )}
              {rewards.length > 0 && (
                <div className="card">
                  <div className="card-title">Registration Rewards</div>
                  {rewards.map((r, i) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < rewards.length - 1 ? '1px solid var(--br)' : 'none' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: r.type === 'online' ? '#e8f0fe' : 'var(--gl)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        {r.type === 'online' ? '🌐' : '📋'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{r.customer.firstName} {r.customer.lastName}</div>
                        <div style={{ fontSize: 11, color: 'var(--mu)' }}>{r.customer.customerId} · {fmtDate(r.createdAt)} · {r.type === 'online' ? 'Online' : 'Offline'}</div>
                      </div>
                      <div style={{ fontWeight: 800, color: 'var(--g)', fontSize: 14 }}>+₦{r.amount.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
