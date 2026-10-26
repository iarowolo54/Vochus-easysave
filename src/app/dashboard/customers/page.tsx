'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
  savingsPlans: any[]
  photoUrl?: string | null
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [custTxns, setCustTxns] = useState<any[]>([])
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const limit = 10
  const router = useRouter()

  async function generateInvite() {
    setInviteLoading(true)
    try {
      const res = await fetch('/api/agent/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.link) setInviteLink(data.link)
    } finally { setInviteLoading(false) }
  }

  function copyInvite() {
    navigator.clipboard?.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      search, status, plan, page: String(page), limit: String(limit),
    })
    const res = await fetch(`/api/customers?${params}`)
    const data = await res.json()
    setCustomers(data.customers ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [search, status, plan, page])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [load])

  const totalPages = Math.ceil(total / limit)

  async function viewCustomer(c: Customer) {
    setSelected(c)
    setExpandedPlan(null)
    setCustTxns([])
    setTxnsLoading(true)
    try {
      const res = await fetch(`/api/transactions?customerId=${c.id}&limit=100`)
      const data = await res.json()
      setCustTxns(data.transactions ?? [])
    } finally { setTxnsLoading(false) }
  }

  const avColors = ['av-g', 'av-b', 'av-gd', 'av-rd', 'av-pu']
  const initials = (c: Customer) => `${c.firstName[0]}${c.lastName[0]}`

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><h2>Customers</h2><p>Manage all enrolled customers under your portfolio</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-out btn-sm" onClick={generateInvite} disabled={inviteLoading}>
            {inviteLoading ? '…' : '🔗 Invite Customer'}
          </button>
          <Link href="/dashboard/enrol" className="btn btn-g">+ Enrol New Customer</Link>
        </div>
      </div>

      {inviteLink && (
        <div className="card" style={{ marginBottom: 14, padding: '12px 16px', background: 'var(--gl)', border: '1px solid var(--gm)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g)', marginBottom: 6 }}>Customer Invite Link (one-time use)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={inviteLink} style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--gm)', background: 'var(--card)', color: 'var(--txt)', fontFamily: 'monospace' }} onClick={e => (e.target as HTMLInputElement).select()} />
            <button className="btn btn-g btn-sm" onClick={copyInvite} style={{ flexShrink: 0 }}>{inviteCopied ? '✓ Copied' : '📋 Copy'}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="isearch" style={{ flex: 1, minWidth: 200 }}>
            <span className="sicon">🔍</span>
            <input
              className="finput"
              type="text"
              placeholder="Search by name, phone, ID…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select className="finput" style={{ width: 160 }} value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
            <option value="">All Status</option>
            <option>Active</option><option>Inactive</option><option>Flagged</option>
          </select>
          <select className="finput" style={{ width: 160 }} value={plan} onChange={e => { setPlan(e.target.value); setPage(1) }}>
            <option value="">All Plans</option>
            <option value="30">30 Days</option><option value="60">60 Days</option>
            <option value="90">90 Days</option><option value="180">180 Days</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th><th>ID</th><th>Phone</th><th>Savings Balance</th><th>Plan</th><th>Active Loan</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>Loading…</td></tr>
              )}
              {!loading && customers.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>No customers found</td></tr>
              )}
              {!loading && customers.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {c.photoUrl
                        ? <img src={c.photoUrl} alt={initials(c)} className="av" style={{ objectFit: 'cover' }} />
                        : <div className={`av ${avColors[i % avColors.length]}`}>{initials(c)}</div>}
                      <div className="td-name">{c.firstName} {c.lastName}</div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--b)', fontWeight: 600 }}>{c.customerId}</td>
                  <td>{c.phone}</td>
                  <td className="td-mono" style={{ color: 'var(--g)' }}>₦{c.savingsBalance.toLocaleString()}</td>
                  <td>
                    {c.savingsPlans.length === 0 ? '—' : (() => {
                      const active = c.savingsPlans.filter((p: any) => p.status === 'Active')
                      const other = c.savingsPlans.filter((p: any) => p.status !== 'Active')
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {active.length > 0 && (
                            <span className="bdg bdg-ok" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
                              {active.length} Active
                            </span>
                          )}
                          {other.length > 0 && (
                            <span className="bdg bdg-b" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
                              {other.length} Other
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td>
                    {c.activeLoan
                      ? <span className="bdg bdg-rd">₦{c.activeLoan.totalAmount.toLocaleString()}</span>
                      : '—'}
                  </td>
                  <td>
                    <span className={`bdg ${c.status === 'Active' ? 'bdg-ok' : c.status === 'Flagged' ? 'bdg-rd' : 'bdg-gd'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-out btn-sm" onClick={() => viewCustomer(c)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--br)', fontSize: 12.5, color: 'var(--mu)' }}>
          <span>Showing {customers.length} of {total} customers</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-out btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className="btn btn-out btn-sm"
                style={p === page ? { background: 'var(--g)', color: '#fff', borderColor: 'var(--g)' } : {}}
                onClick={() => setPage(p)}
              >{p}</button>
            ))}
            <button className="btn btn-out btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{selected.firstName} {selected.lastName} — Profile</div>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              {selected.photoUrl
                ? <img src={selected.photoUrl} alt={initials(selected)} className="av" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: '50%' }} />
                : <div className="av av-g" style={{ width: 56, height: 56, fontSize: 20 }}>{initials(selected)}</div>}
              <div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 18 }}>{selected.firstName} {selected.lastName}</div>
                <div style={{ color: 'var(--b)', fontWeight: 600 }}>{selected.customerId}</div>
              </div>
            </div>
            <div className="conf-table">
              <div className="conf-row"><span className="conf-lbl">Phone</span><span className="conf-val">{selected.phone}</span></div>
              <div className="conf-row"><span className="conf-lbl">Total Balance</span><strong style={{ color: 'var(--g)', fontSize: 16 }}>₦{selected.savingsBalance.toLocaleString()}</strong></div>
              <div className="conf-row"><span className="conf-lbl">Active Loan</span><span className="conf-val">{selected.activeLoan ? `₦${selected.activeLoan.totalAmount.toLocaleString()}` : 'None'}</span></div>
            </div>
            {selected.savingsPlans.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  Savings Plans ({selected.savingsPlans.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selected.savingsPlans.map((p: any) => {
                    const planTxns = custTxns.filter((t: any) => t.planId === p.id)
                    const isOpen = expandedPlan === p.id
                    return (
                      <div key={p.id} style={{ background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--br)', overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                              {p.cadence === 'weekly'
                                ? `${p.periodDays / 7} Weeks · ${p.goal}`
                                : `${p.periodDays} Days · ${p.goal}`
                              }
                            </span>
                            <span className={`bdg ${p.status === 'Active' ? 'bdg-ok' : 'bdg-b'}`}>{p.status}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--mu)', flexWrap: 'wrap' }}>
                            <span>Balance: <strong style={{ color: 'var(--g)' }}>₦{p.balance.toLocaleString()}</strong></span>
                            <span>₦{p.cadence === 'weekly' ? (p.dailyAmount * 7).toLocaleString() : p.dailyAmount.toLocaleString()}/{p.cadence === 'weekly' ? 'week' : 'day'}</span>
                            <span>Matures: {new Date(p.maturityDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setExpandedPlan(isOpen ? null : p.id)}
                          style={{ width: '100%', padding: '7px 14px', background: 'var(--br)', border: 'none', borderTop: '1px solid var(--br)', cursor: 'pointer', fontSize: 12, color: 'var(--mu)', fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                        >
                          <span>
                            {txnsLoading ? 'Loading transactions…' : `${planTxns.length} transaction${planTxns.length !== 1 ? 's' : ''}`}
                          </span>
                          <span>{isOpen ? '▲ Hide' : '▼ Show'}</span>
                        </button>
                        {isOpen && (
                          <div style={{ borderTop: '1px solid var(--br)' }}>
                            {planTxns.length === 0 ? (
                              <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--mu)', textAlign: 'center' }}>No transactions yet</div>
                            ) : (
                              <div>
                                {planTxns.map((t: any, i: number) => (
                                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < planTxns.length - 1 ? '1px solid var(--br)' : 'none' }}>
                                    <span style={{ fontSize: 16 }}>
                                      {t.type === 'saving' ? '💰' : t.type === 'redemption' ? '🎯' : t.type === 'repayment' ? '🔄' : '📊'}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--txt)' }}>
                                        {t.type === 'saving' ? 'Saving' : t.type === 'redemption' ? 'Redemption' : t.type === 'repayment' ? 'Repayment' : t.type}
                                        {t.method && <span style={{ fontWeight: 400, color: 'var(--mu)', marginLeft: 6 }}>· {t.method}</span>}
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--mu)' }}>
                                        {new Date(t.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        {' '}· {new Date(t.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: t.type === 'saving' ? 'var(--g)' : 'var(--rd)' }}>
                                        {t.type === 'saving' ? '+' : '−'}₦{t.amount.toLocaleString()}
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--mu)' }}>{t.status}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 20 }}>
              <button className="btn btn-g" onClick={() => { setSelected(null); router.push(`/dashboard/savings?cid=${selected.customerId}`) }}>💰 Record Saving</button>
              <button className="btn btn-out" onClick={() => { setSelected(null); router.push(`/dashboard/add-plan?cid=${selected.customerId}`) }}>➕ Add Plan</button>
              <button className="btn btn-pu" onClick={() => { setSelected(null); router.push(`/dashboard/loan-request?cid=${selected.customerId}`) }}>🏦 Loan Request</button>
              <button className="btn btn-b" onClick={() => { setSelected(null); router.push(`/dashboard/loan-repay?cid=${selected.customerId}`) }}>🔄 Repayment</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
