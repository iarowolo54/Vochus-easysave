'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Plan {
  id: string; goal: string; dailyAmount: number; periodDays: number
  balance: number; status: string; startDate: string; maturityDate: string; notes: string | null
  transactions: Tx[]
}

interface Tx {
  id: string; ref: string; type: string; amount: number; method: string | null
  status: string; note: string | null; createdAt: string
}

interface Loan {
  id: string; ref: string; principal: number; totalAmount: number; interestRate: number
  durationDays: number; dueDate: string; status: string; createdAt: string
  repayments: { id: string; amount: number; createdAt: string }[]
}

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; email: string | null; address: string; status: string; createdAt: string; photoUrl?: string | null
  savingsPlans: Plan[]; loans: Loan[]
  memberCards: { serial: string; status: string; linkedAt: string | null }[]
}

interface AgentDetail {
  id: string; agentId: string; name: string; phone: string; email: string | null
  location: string; walletBalance: number; status: string; createdAt: string
  photoUrl?: string | null
  boundDeviceId?: string | null
  bankName?: string | null
  accountNumber?: string | null
  accountName?: string | null
  customers: Customer[]
  transactions: Tx[]
  memberCards: { serial: string; status: string }[]
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ngn(n: number) {
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function badge(s: string) {
  const map: Record<string, [string, string]> = {
    Active: ['#dcfce7', '#16a34a'], Suspended: ['#fee2e2', '#dc2626'],
    Done: ['#dcfce7', '#16a34a'], Pending: ['#fef3c7', '#d97706'],
    Approved: ['#dbeafe', '#1d4ed8'], Rejected: ['#fee2e2', '#dc2626'],
    Linked: ['#dcfce7', '#16a34a'], Unlinked: ['#fef3c7', '#d97706'],
    Completed: ['#dcfce7', '#16a34a'], Withdrawn: ['#f1f5f9', '#64748b'],
  }
  const [bg, color] = map[s] ?? ['#f1f5f9', '#64748b']
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: bg, color }}>{s}</span>
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'customers' | 'transactions' | 'loans' | 'cards'>('customers')
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)
  const [customerTab, setCustomerTab] = useState<Record<string, 'plans' | 'loans' | 'cards'>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/agents/${id}/detail`)
    if (res.ok) {
      const d = await res.json()
      setAgent(d.agent)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>Loading agent details…</div>
  if (!agent) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>Agent not found. <Link href="/superadmin/agents" style={{ color: 'var(--accent)' }}>Back to agents</Link></div>

  const totalSavings = agent.customers.reduce((s, c) => s + c.savingsPlans.reduce((a, p) => a + p.balance, 0), 0)
  const totalLoans = agent.customers.reduce((s, c) => s + c.loans.filter(l => l.status === 'Approved').reduce((a, l) => a + l.principal, 0), 0)
  const allLoans = agent.customers.flatMap(c => c.loans.map(l => ({ ...l, customerName: `${c.firstName} ${c.lastName}`, customerId: c.customerId })))

  function getCustTab(cid: string) { return customerTab[cid] ?? 'plans' }
  function setCustTab(cid: string, t: 'plans' | 'loans' | 'cards') {
    setCustomerTab(prev => ({ ...prev, [cid]: t }))
  }

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, padding: '4px 0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          ← Back to Agents
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0, overflow: 'hidden' }}>
            {agent.photoUrl
              ? <img src={agent.photoUrl} alt={agent.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : agent.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{agent.name}</h1>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>{agent.agentId} · {agent.location} · {agent.phone}</div>
            {agent.accountName && (
              <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4, fontWeight: 600 }}>
                🏦 {agent.accountName} · {agent.bankName} · {agent.accountNumber}
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {agent.boundDeviceId && (
              <button
                onClick={async () => {
                  if (!confirm('Reset device binding? The agent will be able to log in from a new mobile device.')) return
                  const res = await fetch(`/api/admin/agents/${id}/reset-device`, { method: 'POST' })
                  if (res.ok) load()
                  else alert('Failed to reset device')
                }}
                style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, background: '#fff', color: 'var(--accent)', border: '1.5px solid var(--accent)', borderRadius: 8, cursor: 'pointer' }}
                title={`Bound device: ${agent.boundDeviceId.slice(0, 8)}…`}
              >
                📱 Reset Device
              </button>
            )}
            {badge(agent.status)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 26 }}>
        {[
          { icon: '👥', label: 'Customers', value: agent.customers.length, color: 'var(--blue)' },
          { icon: '💰', label: 'Total Savings', value: ngn(totalSavings), color: 'var(--green)' },
          { icon: '🏦', label: 'Active Loans', value: ngn(totalLoans), color: '#7c3aed' },
          { icon: '💼', label: 'Wallet Balance', value: ngn(agent.walletBalance), color: 'var(--accent)' },
        ].map(({ icon, label, value, color }) => (
          <div key={label} className="stat">
            <span className="stat-ic">{icon}</span>
            <div className="stat-lbl">{label}</div>
            <div className="stat-val" style={{ color, fontSize: typeof value === 'string' ? 16 : undefined }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {([
          { key: 'customers', label: `Customers (${agent.customers.length})` },
          { key: 'transactions', label: `Transactions (${agent.transactions.length})` },
          { key: 'loans', label: `Loans (${allLoans.length})` },
          { key: 'cards', label: `Cards (${agent.memberCards.length})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key as typeof tab)} style={{
            padding: '10px 20px', background: 'none', border: 'none',
            borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -2, fontWeight: tab === key ? 700 : 400,
            color: tab === key ? 'var(--accent)' : 'var(--text2)',
            cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>

      {/* Customers tab */}
      {tab === 'customers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agent.customers.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No customers registered under this agent</div>
          ) : agent.customers.map(c => {
            const expanded = expandedCustomer === c.id
            const ct = getCustTab(c.id)
            const totalBal = c.savingsPlans.reduce((s, p) => s + p.balance, 0)
            return (
              <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Customer header */}
                <div
                  onClick={() => setExpandedCustomer(expanded ? null : c.id)}
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, background: expanded ? 'var(--hover)' : 'transparent', transition: 'background .15s' }}
                >
                  {c.photoUrl
                    ? <img src={c.photoUrl} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{`${c.firstName[0]}${c.lastName[0]}`.toUpperCase()}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.firstName} {c.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.customerId} · {c.phone}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Savings</div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>{ngn(totalBal)}</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 40 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Plans</div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.savingsPlans.length}</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 40 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>Loans</div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.loans.length}</div>
                    </div>
                    {badge(c.status)}
                    <span style={{ color: 'var(--text3)', fontSize: 16 }}>{expanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Sub-tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--hover)' }}>
                      {(['plans', 'loans', 'cards'] as const).map(t => (
                        <button key={t} onClick={() => setCustTab(c.id, t)} style={{
                          padding: '8px 18px', background: 'none', border: 'none',
                          borderBottom: ct === t ? '2px solid var(--accent)' : '2px solid transparent',
                          fontWeight: ct === t ? 700 : 400,
                          color: ct === t ? 'var(--accent)' : 'var(--text3)',
                          cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
                        }}>
                          {t === 'plans' ? `Savings Plans (${c.savingsPlans.length})` : t === 'loans' ? `Loans (${c.loans.length})` : `Cards (${c.memberCards.length})`}
                        </button>
                      ))}
                    </div>

                    {/* Savings Plans */}
                    {ct === 'plans' && (
                      <div style={{ padding: 16 }}>
                        {c.savingsPlans.length === 0 ? (
                          <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No savings plans</p>
                        ) : c.savingsPlans.map(plan => (
                          <div key={plan.id} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--surface2)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{plan.goal || 'Savings Plan'}</div>
                                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{ngn(plan.dailyAmount)}/day · {plan.periodDays} days · {fmt(plan.startDate)} → {fmt(plan.maturityDate)}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', fontWeight: 600 }}>Balance</div>
                                  <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: 15 }}>{ngn(plan.balance)}</div>
                                </div>
                                {badge(plan.status)}
                              </div>
                            </div>
                            {plan.transactions.length > 0 && (
                              <div style={{ padding: '8px 0' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 16px 8px' }}>Transactions ({plan.transactions.length})</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                  <thead>
                                    <tr style={{ background: 'var(--hover)' }}>
                                      <th style={{ textAlign: 'left', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Ref</th>
                                      <th style={{ textAlign: 'left', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Type</th>
                                      <th style={{ textAlign: 'left', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Amount</th>
                                      <th style={{ textAlign: 'left', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Method</th>
                                      <th style={{ textAlign: 'left', padding: '6px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {plan.transactions.slice(0, 20).map(tx => (
                                      <tr key={tx.id} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{tx.ref}</td>
                                        <td style={{ padding: '7px 16px' }}><span style={{ fontWeight: 600, color: tx.type === 'Deposit' ? 'var(--green)' : tx.type === 'Withdrawal' ? '#dc2626' : 'var(--text2)' }}>{tx.type}</span></td>
                                        <td style={{ padding: '7px 16px', fontWeight: 700 }}>{ngn(tx.amount)}</td>
                                        <td style={{ padding: '7px 16px', fontSize: 12, color: 'var(--text3)' }}>{tx.method ?? '—'}</td>
                                        <td style={{ padding: '7px 16px', fontSize: 12, color: 'var(--text3)' }}>{fmt(tx.createdAt)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {plan.transactions.length > 20 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 16px' }}>+ {plan.transactions.length - 20} more transactions</div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Loans */}
                    {ct === 'loans' && (
                      <div style={{ padding: 16 }}>
                        {c.loans.length === 0 ? (
                          <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No loans</p>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr>
                                {['Ref', 'Principal', 'Total', 'Rate', 'Due Date', 'Repaid', 'Status'].map(h => (
                                  <th key={h} style={{ textAlign: 'left', padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {c.loans.map(l => {
                                const repaid = l.repayments.reduce((s, r) => s + r.amount, 0)
                                return (
                                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{l.ref}</td>
                                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>{ngn(l.principal)}</td>
                                    <td style={{ padding: '8px 12px' }}>{ngn(l.totalAmount)}</td>
                                    <td style={{ padding: '8px 12px', color: 'var(--text3)' }}>{l.interestRate}%</td>
                                    <td style={{ padding: '8px 12px', color: 'var(--text3)' }}>{fmt(l.dueDate)}</td>
                                    <td style={{ padding: '8px 12px', color: 'var(--green)', fontWeight: 600 }}>{ngn(repaid)}</td>
                                    <td style={{ padding: '8px 12px' }}>{badge(l.status)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {/* Cards */}
                    {ct === 'cards' && (
                      <div style={{ padding: 16 }}>
                        {c.memberCards.length === 0 ? (
                          <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No cards linked</p>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {c.memberCards.map(card => (
                              <div key={card.serial} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{card.serial}</span>
                                {badge(card.status)}
                                {card.linkedAt && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmt(card.linkedAt)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Transactions tab */}
      {tab === 'transactions' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {agent.transactions.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No transactions</td></tr>
                ) : agent.transactions.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{tx.ref}</td>
                    <td><span style={{ fontWeight: 600, color: tx.type === 'Deposit' ? 'var(--green)' : tx.type === 'Withdrawal' ? '#dc2626' : 'var(--text2)' }}>{tx.type}</span></td>
                    <td style={{ fontWeight: 700 }}>{ngn(tx.amount)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{tx.method ?? '—'}</td>
                    <td>{badge(tx.status)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.note ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmt(tx.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loans tab */}
      {tab === 'loans' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Customer</th>
                  <th>Principal</th>
                  <th>Total</th>
                  <th>Rate</th>
                  <th>Due Date</th>
                  <th>Repaid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allLoans.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No loans</td></tr>
                ) : allLoans.map(l => {
                  const repaid = l.repayments.reduce((s, r) => s + r.amount, 0)
                  return (
                    <tr key={l.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{l.ref}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.customerName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l.customerId}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{ngn(l.principal)}</td>
                      <td>{ngn(l.totalAmount)}</td>
                      <td style={{ color: 'var(--text3)' }}>{l.interestRate}%</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmt(l.dueDate)}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>{ngn(repaid)}</td>
                      <td>{badge(l.status)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards tab */}
      {tab === 'cards' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {agent.memberCards.length === 0 ? (
                  <tr><td colSpan={2} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No cards issued to this agent</td></tr>
                ) : agent.memberCards.map(card => (
                  <tr key={card.serial}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>{card.serial}</td>
                    <td>{badge(card.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
