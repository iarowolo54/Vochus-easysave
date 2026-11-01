'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Icons, type IconName } from '@/components/ui/icons'
import type { Area } from '@/lib/permissions'

interface Stats {
  totalAgents: number
  totalCustomers: number
  totalSavingsPool: number
  activeLoans: number
  activeLoansPortfolio: number
  pendingLoans: number
  pendingRedemptions: number
}

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  createdAt: string
  customerName: string | null
  agentName: string
}

interface Loan {
  id: string
  ref: string
  principal: number
  customerName: string
  agentName: string
  status: string
  createdAt: string
}

interface Agent {
  id: string
  agentId: string
  name: string
  location: string
  customerCount: number
  walletBalance: number
  commission: number
  status: string
  photoUrl?: string | null
}

const fmt = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`

const TYPE: Record<string, { label: string; icon: IconName }> = {
  saving: { label: 'Saving', icon: 'deposit' },
  redemption: { label: 'Redemption', icon: 'redeem' },
  disbursement: { label: 'Loan paid out', icon: 'cash' },
  repayment: { label: 'Loan repayment', icon: 'repay' },
  enrolment: { label: 'Enrolment', icon: 'enrol' },
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** A stat tile that links through only when the actor holds the area; otherwise a muted, non-link tile. */
function Tile({ href, ok, children }: { href: string; ok: boolean; children: React.ReactNode }) {
  if (ok) return <Link href={href} className="stat">{children}</Link>
  return <div className="stat" style={{ opacity: 0.75 }}>{children}</div>
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [pendingLoans, setPendingLoans] = useState<Loan[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  // Per-area sections whose endpoint 403s for this staffer are hidden, never an error.
  const [denied, setDenied] = useState({ transactions: false, loans: false, agents: false })
  // Areas this actor holds (null until known / if /me fails: nothing is hidden, the API still enforces).
  const [areas, setAreas] = useState<Area[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [toast, setToast] = useState('')
  const [confirming, setConfirming] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [acting, setActing] = useState(false)

  const loadData = useCallback(async () => {
    setFailed(false)
    try {
      const [sRes, tRes, lRes, aRes, mRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/transactions'),
        fetch('/api/admin/loans?status=Pending'),
        fetch('/api/admin/agents'),
        fetch('/api/admin/me').catch(() => null),
      ])
      if (!sRes.ok) throw new Error()
      const [s, t, l, a] = await Promise.all([
        sRes.json(),
        tRes.ok ? tRes.json() : null,
        lRes.ok ? lRes.json() : null,
        aRes.ok ? aRes.json() : null,
      ])
      const me: { areas?: Area[] } | null = mRes?.ok ? await mRes.json().catch(() => null) : null
      setAreas(Array.isArray(me?.areas) ? me.areas : null)
      setDenied({ transactions: tRes.status === 403, loans: lRes.status === 403, agents: aRes.status === 403 })
      setStats(s)
      setTransactions((t?.transactions ?? []).slice(0, 8))
      setPendingLoans((l?.loans ?? []).slice(0, 5))
      setAgents([...(a?.agents ?? [])].sort((x: Agent, y: Agent) => y.customerCount - x.customerCount).slice(0, 5))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  async function handleLoan(loan: Loan, action: 'approve' | 'reject') {
    setActing(true)
    try {
      const res = await fetch(`/api/admin/loans/${loan.id}/${action}`, { method: 'PATCH' })
      if (!res.ok) throw new Error()
      showToast(action === 'approve' ? `Loan ${loan.ref} approved` : `Loan ${loan.ref} rejected`)
      setConfirming(null)
      loadData()
    } catch {
      showToast('That didn’t go through. Check your connection and try again.')
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="skel" style={{ width: 260, height: 34, marginBottom: 28 }} />
        <div className="stats-grid">{[0, 1, 2, 3].map(i => <div key={i} className="stat"><div className="skel" style={{ height: 64 }} /></div>)}</div>
        <div className="g65"><div className="card"><div className="skel" style={{ height: 280 }} /></div><div className="card"><div className="skel" style={{ height: 280 }} /></div></div>
      </div>
    )
  }

  if (failed || !stats) {
    return (
      <div className="card">
        <div className="a-empty">
          <span className="a-empty-ic is-danger"><Icons.error size={22} aria-hidden="true" /></span>
          <h4>We couldn’t load the overview</h4>
          <p>Check your connection and try again.</p>
          <button type="button" className="btn btn-outline" onClick={() => { setLoading(true); loadData() }}><Icons.retry size={16} aria-hidden="true" /> Try again</button>
        </div>
      </div>
    )
  }

  const has = (a: Area) => areas === null || areas.includes(a)
  const showTx = !denied.transactions && has('money')
  const showLoans = !denied.loans && has('loans')
  const showAgents = !denied.agents && has('agents')

  const attention = [
    has('loans') && stats.pendingLoans > 0 && { href: '/superadmin/loan-requests', icon: 'loan' as const, text: `${stats.pendingLoans} loan request${stats.pendingLoans === 1 ? '' : 's'} waiting for a decision` },
    has('customers') && stats.pendingRedemptions > 0 && { href: '/superadmin/early-redemption', icon: 'redeem' as const, text: `${stats.pendingRedemptions} redemption${stats.pendingRedemptions === 1 ? '' : 's'} waiting to be processed` },
  ].filter(Boolean) as { href: string; icon: IconName; text: string }[]

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>{greeting()}</h1>
          <p>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="ov-attention" role="list" aria-label="Needs your attention">
          {attention.map(a => {
            const Icon = Icons[a.icon]
            return (
              <Link key={a.href} href={a.href} className="ov-attention-item" role="listitem">
                <span className="ov-attention-ic" aria-hidden="true"><Icon size={18} /></span>
                <span className="ov-attention-text">{a.text}</span>
                <span className="ov-attention-cta">Review <Icons.next size={16} aria-hidden="true" /></span>
              </Link>
            )
          })}
        </div>
      )}

      <div className="stats-grid">
        <Tile href="/superadmin/savings-monitor" ok={has('customers')}>
          <div className="stat-lbl">Savings held</div>
          <div className="stat-val">{fmt(stats.totalSavingsPool)}</div>
          <div className="stat-sub">Across all plans</div>
        </Tile>
        <Tile href="/superadmin/customers" ok={has('customers')}>
          <div className="stat-lbl">Customers</div>
          <div className="stat-val">{stats.totalCustomers.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Enrolled</div>
        </Tile>
        <Tile href="/superadmin/agents" ok={has('agents')}>
          <div className="stat-lbl">Agents</div>
          <div className="stat-val">{stats.totalAgents.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Registered</div>
        </Tile>
        <Tile href="/superadmin/loan-repay" ok={has('loans')}>
          <div className="stat-lbl">Loans out</div>
          <div className="stat-val">{fmt(stats.activeLoansPortfolio)}</div>
          <div className="stat-sub">{stats.activeLoans} active loan{stats.activeLoans === 1 ? '' : 's'}</div>
        </Tile>
      </div>

      {(showTx || showLoans) && <div className="g65 ov-row">
        {showTx && <section className="card" aria-labelledby="ov-activity">
          <div className="card-hd">
            <h3 id="ov-activity">Recent activity</h3>
            <Link href="/superadmin/transactions" className="card-link">See all</Link>
          </div>
          {transactions.length === 0 ? (
            <div className="a-empty">
              <span className="a-empty-ic"><Icons.history size={22} aria-hidden="true" /></span>
              <h4>No activity yet</h4>
              <p>Savings, loans and redemptions show here as they happen.</p>
            </div>
          ) : (
            <div className="rows">
              {transactions.map(t => {
                const meta = TYPE[t.type] ?? { label: t.type, icon: 'history' as const }
                const Icon = Icons[meta.icon]
                const inflow = t.type === 'saving' || t.type === 'repayment'
                return (
                  <div key={t.id} className="row">
                    <span className="row-ic" aria-hidden="true"><Icon size={18} /></span>
                    <div className="row-main">
                      <div className="row-title">{t.customerName ?? meta.label}</div>
                      <div className="row-sub">{meta.label} · {t.agentName} · {when(t.createdAt)}</div>
                    </div>
                    {t.amount > 0 && (
                      <div className="row-end">
                        <div className={`row-amt${inflow ? ' pos' : ''}`}>{inflow ? '+ ' : ''}{fmt(t.amount)}</div>
                        <div className="row-sub ov-ref">{t.ref}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>}

        {showLoans && <section className="card" aria-labelledby="ov-loans">
          <div className="card-hd">
            <h3 id="ov-loans">Loan requests</h3>
            <Link href="/superadmin/loan-requests" className="card-link">See all</Link>
          </div>
          {pendingLoans.length === 0 ? (
            <div className="a-empty">
              <span className="a-empty-ic"><Icons.check size={22} aria-hidden="true" /></span>
              <h4>You’re all caught up</h4>
              <p>New loan requests from agents will show here.</p>
            </div>
          ) : (
            <div className="rows">
              {pendingLoans.map(l => {
                const c = confirming?.id === l.id ? confirming.action : null
                return (
                  <div key={l.id} className="row ov-loan">
                    <div className="ov-loan-top">
                      <span className="av av-amber" aria-hidden="true">{initials(l.customerName)}</span>
                      <div className="row-main">
                        <div className="row-title">{l.customerName}</div>
                        <div className="row-sub">{l.agentName} · {l.ref}</div>
                      </div>
                      <div className="row-amt">{fmt(l.principal)}</div>
                    </div>
                    {c ? (
                      <div className="ov-confirm" role="group" aria-label="Confirm decision">
                        <span>{c === 'approve' ? `Approve ${fmt(l.principal)}?` : 'Reject this request?'}</span>
                        <button type="button" className="btn btn-outline btn-xs" disabled={acting} onClick={() => setConfirming(null)}>Cancel</button>
                        <button type="button" className={`btn btn-xs ${c === 'approve' ? 'btn-green' : 'btn-danger'}`} disabled={acting} onClick={() => handleLoan(l, c)}>
                          {acting ? 'Saving…' : c === 'approve' ? 'Yes, approve' : 'Yes, reject'}
                        </button>
                      </div>
                    ) : (
                      <div className="ov-confirm">
                        <button type="button" className="btn btn-green btn-xs" onClick={() => setConfirming({ id: l.id, action: 'approve' })}>Approve</button>
                        <button type="button" className="btn btn-outline btn-xs" onClick={() => setConfirming({ id: l.id, action: 'reject' })}>Reject</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>}
      </div>}

      {showAgents && <section className="card" aria-labelledby="ov-agents">
        <div className="card-hd">
          <h3 id="ov-agents">Agents with the most customers</h3>
          <Link href="/superadmin/agents" className="card-link">All agents</Link>
        </div>
        {agents.length === 0 ? (
          <div className="a-empty">
            <span className="a-empty-ic"><Icons.customers size={22} aria-hidden="true" /></span>
            <h4>No agents yet</h4>
            <p>Approved agents show here.</p>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Location</th>
                  <th className="num">Customers</th>
                  <th className="num">Wallet</th>
                  <th className="num">Commission</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(a => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/superadmin/agents/${a.id}`} className="td-av ov-agent-link">
                        <span className="av av-green" aria-hidden="true">{a.photoUrl ? <img src={a.photoUrl} alt="" /> : initials(a.name)}</span>
                        <span>
                          <span className="td-name ui-block">{a.name}</span>
                          <span className="td-sub ui-block">{a.agentId}</span>
                        </span>
                      </Link>
                    </td>
                    <td>{a.location || '—'}</td>
                    <td className="num">{a.customerCount}</td>
                    <td className="num">{fmt(a.walletBalance)}</td>
                    <td className="num">{fmt(a.commission)}</td>
                    <td>
                      <span className={`bdg ${a.status === 'Active' ? 'bdg-g' : a.status === 'Suspended' ? 'bdg-r' : 'bdg-a'}`}>{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      <div className={`a-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  )
}
