'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, LoadError, Pager, Segmented, TableSkeleton, nairaKobo, shortDate, useToast,
} from '../../_components/admin-ui'
import { SendResetCodeModal } from '../../_components/send-reset-code'

interface Tx {
  id: string; ref: string; type: string; amount: number; method: string | null
  status: string; note: string | null; createdAt: string
}

interface Plan {
  id: string; goal: string; dailyAmount: number; periodDays: number
  balance: number; status: string; startDate: string; maturityDate: string; notes: string | null
  transactions: Tx[]
}

interface Loan {
  id: string; ref: string; principal: number; totalAmount: number; interestRate: number
  durationDays: number; dueDate: string; status: string; createdAt: string
  repayments: { id: string; amount: number; createdAt: string }[]
}

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; email: string | null; address: string; status: string; createdAt: string
  savingsPlans: Plan[]; loans: Loan[]
  memberCards: { serial: string; status: string; linkedAt: string | null }[]
}

interface AgentDetail {
  id: string; agentId: string; name: string; phone: string; email: string | null
  location: string; walletBalance: number; status: string; createdAt: string
  deviceBound?: boolean
  bankName?: string | null
  accountNumber?: string | null
  accountName?: string | null
  customers: Customer[]
  transactions: Tx[]
  memberCards: { serial: string; status: string }[]
}

type Tab = 'customers' | 'transactions' | 'loans' | 'cards'
type CustTab = 'plans' | 'loans' | 'cards'

const PLAN_TX_LIMIT = 20
const PAGE_SIZE = 25

const BADGE: Record<string, [cls: string, label: string]> = {
  Active: ['bdg-g', 'Active'], Suspended: ['bdg-r', 'Suspended'], PendingActivation: ['bdg-a', 'Waiting to activate'],
  Done: ['bdg-g', 'Done'], Pending: ['bdg-a', 'Pending'], Failed: ['bdg-r', 'Failed'],
  Approved: ['bdg-b', 'Approved'], Rejected: ['bdg-r', 'Rejected'], Repaid: ['bdg-g', 'Repaid'], Overdue: ['bdg-r', 'Overdue'],
  Linked: ['bdg-g', 'Linked'], Unlinked: ['bdg-a', 'Not linked'],
  Completed: ['bdg-g', 'Completed'], Withdrawn: ['bdg-grey', 'Withdrawn'], Matured: ['bdg-b', 'Matured'],
}

function StatusBadge({ s }: { s: string }) {
  const [cls, label] = BADGE[s] ?? ['bdg-grey', s]
  return <span className={`bdg ${cls}`}>{label}</span>
}

const TX_LABELS: Record<string, string> = {
  saving: 'Savings', Deposit: 'Deposit', Withdrawal: 'Withdrawal', withdrawal: 'Withdrawal',
  wallet_funding: 'Wallet top-up', commission_payout: 'Commission payout', commission: 'Commission',
  loan_disbursement: 'Loan paid out', loan_repayment: 'Loan repayment',
}
function txLabel(t: string) {
  if (TX_LABELS[t]) return TX_LABELS[t]
  const s = t.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
function TxType({ t }: { t: string }) {
  const out = /withdraw/i.test(t)
  const inn = t === 'Deposit' || t === 'saving'
  return <span className={out ? 'am-neg' : inn ? 'am-pos' : undefined}>{txLabel(t)}</span>
}

const repaidOf = (l: Loan) => l.repayments.reduce((s, r) => s + r.amount, 0)
const fullName = (c: Customer) => `${c.firstName} ${c.lastName}`.trim()

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('customers')
  const [custPage, setCustPage] = useState(1)
  const [txPage, setTxPage] = useState(1)
  const [loanPage, setLoanPage] = useState(1)
  const [cardPage, setCardPage] = useState(1)
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)
  const [customerTab, setCustomerTab] = useState<Record<string, CustTab>>({})
  const [toastNode, toast] = useToast()

  const [confirmReset, setConfirmReset] = useState(false)
  const [sendCode, setSendCode] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false); setNotFound(false)
    try {
      const res = await fetch(`/api/admin/agents/${id}/detail`)
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) throw new Error()
      const d = await res.json() as { agent?: AgentDetail }
      if (!d.agent) { setNotFound(true); return }
      setAgent(d.agent)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { setCustPage(1); setTxPage(1); setLoanPage(1); setCardPage(1) }, [id])

  async function resetDevice() {
    setResetting(true); setResetError('')
    try {
      const res = await fetch(`/api/admin/agents/${id}/reset-device`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setResetError(d.error ?? 'The device wasn’t reset. Try again.')
        return
      }
      setConfirmReset(false)
      toast('Device reset. The agent can now sign in on a new phone.', 'success')
      load()
    } catch {
      setResetError('No connection. Check your internet and try again.')
    } finally {
      setResetting(false)
    }
  }

  const back = (
    <Link href="/superadmin/agents" className="am-back"><Icons.back size={18} aria-hidden="true" /> Agents</Link>
  )

  if (loading && !agent) {
    return (
      <>
        {back}
        <div className="am-hero" aria-hidden="true">
          <span className="skel av" />
          <div className="am-hero-main">
            <div className="skel am-skel-title" />
            <div className="skel am-skel-line am-skel-sub" />
          </div>
        </div>
        <section className="card"><TableSkeleton rows={6} cols={5} /></section>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        {back}
        <section className="card">
          <Empty icon="customers" title="We couldn’t find this agent" text="They may have been removed, or the link is wrong."
            action={<Link href="/superadmin/agents" className="btn btn-outline">Back to agents</Link>} />
        </section>
      </>
    )
  }

  if (failed || !agent) {
    return (
      <>
        {back}
        <section className="card"><LoadError what="this agent" onRetry={load} /></section>
      </>
    )
  }

  const totalSavings = agent.customers.reduce((s, c) => s + c.savingsPlans.reduce((a, p) => a + p.balance, 0), 0)
  const totalLoans = agent.customers.reduce((s, c) => s + c.loans.filter(l => l.status === 'Approved').reduce((a, l) => a + l.principal, 0), 0)
  const allLoans = agent.customers.flatMap(c => c.loans.map(l => ({ ...l, customerName: fullName(c), customerId: c.customerId })))

  const pageOf = <T,>(rows: T[], n: number) => rows.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE)

  const custTabOf = (cid: string) => customerTab[cid] ?? 'plans'
  const setCustTab = (cid: string, t: CustTab) => setCustomerTab(prev => ({ ...prev, [cid]: t }))

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'customers', label: 'Customers', count: agent.customers.length },
    { key: 'transactions', label: 'Transactions', count: agent.transactions.length },
    { key: 'loans', label: 'Loans', count: allLoans.length },
    { key: 'cards', label: 'Cards', count: agent.memberCards.length },
  ]

  return (
    <>
      {back}

      <header className="am-hero">
        <Avatar name={agent.name} tone={agent.status === 'Active' ? 'green' : 'amber'} />
        <div className="am-hero-main">
          <h1>{agent.name}</h1>
          <p className="am-hero-meta">{[agent.agentId, agent.location, agent.phone].filter(Boolean).join(' · ')}</p>
          {agent.accountName && (
            <p className="am-bank">
              <Icons.loan size={16} aria-hidden="true" />
              <span><span className="sr-only">Payout account: </span>{[agent.accountName, agent.bankName, agent.accountNumber].filter(Boolean).join(' · ')}</span>
            </p>
          )}
        </div>
        <div className="am-hero-end">
          <StatusBadge s={agent.status} />
          {agent.deviceBound && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setResetError(''); setConfirmReset(true) }}>
              <Icons.device size={16} aria-hidden="true" /> Reset device
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSendCode(true)}>
            <Icons.locked size={16} aria-hidden="true" /> Send reset code
          </button>
        </div>
      </header>

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-lbl">Customers</div>
          <div className="stat-val">{agent.customers.length.toLocaleString('en-NG')}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Customer savings</div>
          <div className="stat-val">{nairaKobo(totalSavings)}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Active loans</div>
          <div className="stat-val">{nairaKobo(totalLoans)}</div>
          <div className="stat-sub">Approved, not yet repaid</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Wallet balance</div>
          <div className="stat-val">{nairaKobo(agent.walletBalance)}</div>
        </div>
      </div>

      <div className="tab-bar am-tabs" role="tablist" aria-label="Agent records">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`}
            className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}<span className="am-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'customers' && (
          agent.customers.length === 0 ? (
            <section className="card"><Empty icon="customers" title="No customers yet" text="Customers this agent registers will show here." /></section>
          ) : (
            <>
            <div className="am-custs">
              {pageOf(agent.customers, custPage).map(c => {
                const expanded = expandedCustomer === c.id
                const ct = custTabOf(c.id)
                const bal = c.savingsPlans.reduce((s, p) => s + p.balance, 0)
                return (
                  <section key={c.id} className="card am-cust" aria-label={fullName(c)}>
                    <button type="button" className="am-cust-hd" aria-expanded={expanded} aria-controls={`cust-${c.id}`}
                      onClick={() => setExpandedCustomer(expanded ? null : c.id)}>
                      <Avatar name={fullName(c)} />
                      <span className="am-cust-name">
                        <span className="row-title ui-block">{fullName(c)}</span>
                        <span className="row-sub ui-block">{c.customerId} · {c.phone}</span>
                      </span>
                      <span className="am-figs">
                        <span className="am-fig"><span className="am-fig-lbl">Savings</span><span className="am-fig-val">{nairaKobo(bal)}</span></span>
                        <span className="am-fig"><span className="am-fig-lbl">Plans</span><span className="am-fig-val">{c.savingsPlans.length}</span></span>
                        <span className="am-fig"><span className="am-fig-lbl">Loans</span><span className="am-fig-val">{c.loans.length}</span></span>
                        <StatusBadge s={c.status} />
                      </span>
                      <Icons.expand size={20} className="am-chev" aria-hidden="true" />
                    </button>

                    {expanded && (
                      <div className="am-cust-body" id={`cust-${c.id}`}>
                        <Segmented<CustTab> label={`${fullName(c)}’s records`} value={ct} onChange={t => setCustTab(c.id, t)} options={[
                          { value: 'plans', label: 'Savings plans', count: c.savingsPlans.length },
                          { value: 'loans', label: 'Loans', count: c.loans.length },
                          { value: 'cards', label: 'Cards', count: c.memberCards.length },
                        ]} />

                        {ct === 'plans' && (c.savingsPlans.length === 0
                          ? <p className="am-inline-empty">No savings plans yet.</p>
                          : c.savingsPlans.map(plan => (
                            <div key={plan.id} className="am-plan">
                              <div className="am-plan-hd">
                                <div className="row-main">
                                  <div className="row-title">{plan.goal || 'Savings plan'}</div>
                                  <div className="row-sub">{nairaKobo(plan.dailyAmount)} a day · {plan.periodDays} days · {shortDate(plan.startDate)} to {shortDate(plan.maturityDate)}</div>
                                </div>
                                <div className="am-plan-end">
                                  <span className="am-fig"><span className="am-fig-lbl">Balance</span><span className="am-fig-val">{nairaKobo(plan.balance)}</span></span>
                                  <StatusBadge s={plan.status} />
                                </div>
                              </div>
                              {plan.transactions.length > 0 && (
                                <div className="am-plan-body">
                                  <h4 className="am-sub-h">Transactions ({plan.transactions.length})</h4>
                                  <div className="am-tbl-wrap tbl-stack">
                                    <table>
                                      <thead><tr><th>Reference</th><th>Type</th><th className="num">Amount</th><th>Method</th><th>Date</th></tr></thead>
                                      <tbody>
                                        {plan.transactions.slice(0, PLAN_TX_LIMIT).map(tx => (
                                          <tr key={tx.id}>
                                            <td className="am-mono am-muted" data-label="Reference">{tx.ref}</td>
                                            <td data-label="Type"><TxType t={tx.type} /></td>
                                            <td className="num am-strong" data-label="Amount">{nairaKobo(tx.amount)}</td>
                                            <td className="am-muted" data-label="Method">{tx.method ?? '—'}</td>
                                            <td className="am-muted am-nowrap" data-label="Date">{shortDate(tx.createdAt)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {plan.transactions.length > PLAN_TX_LIMIT && (
                                    <p className="am-more">Showing the latest {PLAN_TX_LIMIT}. {plan.transactions.length - PLAN_TX_LIMIT} older transactions aren’t shown.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )))}

                        {ct === 'loans' && (c.loans.length === 0
                          ? <p className="am-inline-empty">No loans.</p>
                          : (
                            <div className="am-tbl-wrap tbl-stack">
                              <table>
                                <thead><tr><th>Reference</th><th className="num">Principal</th><th className="num">Total to repay</th><th className="num">Rate</th><th>Due</th><th className="num">Repaid</th><th>Status</th></tr></thead>
                                <tbody>
                                  {c.loans.map(l => (
                                    <tr key={l.id}>
                                      <td className="am-mono am-muted" data-label="Reference">{l.ref}</td>
                                      <td className="num am-strong" data-label="Principal">{nairaKobo(l.principal)}</td>
                                      <td className="num" data-label="Total to repay">{nairaKobo(l.totalAmount)}</td>
                                      <td className="num am-muted" data-label="Rate">{l.interestRate}%</td>
                                      <td className="am-muted am-nowrap" data-label="Due">{shortDate(l.dueDate)}</td>
                                      <td className="num am-pos" data-label="Repaid">{nairaKobo(repaidOf(l))}</td>
                                      <td data-label="Status"><StatusBadge s={l.status} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}

                        {ct === 'cards' && (c.memberCards.length === 0
                          ? <p className="am-inline-empty">No cards linked.</p>
                          : (
                            <ul className="am-chips">
                              {c.memberCards.map(card => (
                                <li key={card.serial} className="am-chip">
                                  <span className="am-mono am-strong">{card.serial}</span>
                                  <StatusBadge s={card.status} />
                                  {card.linkedAt && <span className="am-chip-date">Linked {shortDate(card.linkedAt)}</span>}
                                </li>
                              ))}
                            </ul>
                          ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
            <Pager page={custPage} pageSize={PAGE_SIZE} total={agent.customers.length} onPage={p => { setCustPage(p); setExpandedCustomer(null) }} />
            </>
          )
        )}

        {tab === 'transactions' && (
          <section className="card" aria-label="Transactions">
            {agent.transactions.length === 0 ? <Empty icon="history" title="No transactions yet" text="Savings, top-ups and payouts for this agent will show here." /> : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th>Reference</th><th>Type</th><th className="num">Amount</th><th>Method</th><th>Status</th><th>Note</th><th>Date</th></tr></thead>
                    <tbody>
                      {pageOf(agent.transactions, txPage).map(tx => (
                        <tr key={tx.id}>
                          <td className="am-mono am-muted">{tx.ref}</td>
                          <td><TxType t={tx.type} /></td>
                          <td className="num am-strong">{nairaKobo(tx.amount)}</td>
                          <td className="am-muted">{tx.method ?? '—'}</td>
                          <td><StatusBadge s={tx.status} /></td>
                          <td className="am-muted"><span className="am-clip" title={tx.note ?? undefined}>{tx.note ?? '—'}</span></td>
                          <td className="am-muted am-nowrap">{shortDate(tx.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={txPage} pageSize={PAGE_SIZE} total={agent.transactions.length} onPage={setTxPage} />
                {agent.transactions.length >= 200 && <p className="am-more">Showing the latest 200 transactions.</p>}
              </>
            )}
          </section>
        )}

        {tab === 'loans' && (
          <section className="card" aria-label="Loans">
            {allLoans.length === 0 ? <Empty icon="loan" title="No loans yet" text="Loans for this agent’s customers will show here." /> : (
              <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead><tr><th>Customer</th><th>Reference</th><th className="num">Principal</th><th className="num">Total to repay</th><th className="num">Rate</th><th>Due</th><th className="num">Repaid</th><th>Status</th></tr></thead>
                  <tbody>
                    {pageOf(allLoans, loanPage).map(l => (
                      <tr key={l.id}>
                        <td>
                          <span className="td-name ui-block">{l.customerName}</span>
                          <span className="td-sub ui-block">{l.customerId}</span>
                        </td>
                        <td className="am-mono am-muted" data-label="Reference">{l.ref}</td>
                        <td className="num am-strong" data-label="Principal">{nairaKobo(l.principal)}</td>
                        <td className="num" data-label="Total to repay">{nairaKobo(l.totalAmount)}</td>
                        <td className="num am-muted" data-label="Rate">{l.interestRate}%</td>
                        <td className="am-muted am-nowrap" data-label="Due">{shortDate(l.dueDate)}</td>
                        <td className="num am-pos" data-label="Repaid">{nairaKobo(repaidOf(l))}</td>
                        <td data-label="Status"><StatusBadge s={l.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={loanPage} pageSize={PAGE_SIZE} total={allLoans.length} onPage={setLoanPage} />
              </>
            )}
          </section>
        )}

        {tab === 'cards' && (
          <section className="card" aria-label="Cards">
            {agent.memberCards.length === 0 ? <Empty icon="card" title="No cards issued" text="Member cards given to this agent will show here." /> : (
              <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead><tr><th>Serial</th><th>Status</th></tr></thead>
                  <tbody>
                    {pageOf(agent.memberCards, cardPage).map(card => (
                      <tr key={card.serial}>
                        <td className="am-mono am-strong">{card.serial}</td>
                        <td data-label="Status"><StatusBadge s={card.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={cardPage} pageSize={PAGE_SIZE} total={agent.memberCards.length} onPage={setCardPage} />
              </>
            )}
          </section>
        )}
      </div>

      {confirmReset && agent.deviceBound && (
        <ConfirmModal icon="device"
          title={`Reset ${agent.name}’s device?`}
          body={<>Their account is tied to one phone. After a reset, the next phone they sign in on becomes their device. Do this if they’ve lost or changed their phone.</>}
          confirmLabel="Reset device"
          busy={resetting} error={resetError}
          onConfirm={resetDevice} onClose={() => setConfirmReset(false)}
        />
      )}
      {sendCode && (
        <SendResetCodeModal actorType="agent" id={agent.id} name={agent.name} onClose={() => setSendCode(false)}
          onSent={msg => { setSendCode(false); toast(msg, 'success') }} />
      )}

      {toastNode}
    </>
  )
}
