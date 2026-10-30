'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, naira, shortDate, useToast, AmountHero, Ledger, LedgerRow, DialogNote, DialogDone,
} from '../_components/admin-ui'

interface AgentWallet {
  id: string
  agentId: string
  name: string
  location: string
  walletBalance: number
  commissionBalance: number
  floatLimit?: number | null
  status: string
  todayActivity: number
  lastFunded: string | null
  photoUrl?: string | null
}

interface Stats {
  totalWalletBalance: number
  totalFundedToday: number
  lowBalanceCount: number
}

type Filter = 'all' | 'low' | 'commission'

const PAGE_SIZE = 25
const LOW_BALANCE = 10000

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

export default function AgentWalletsPage() {
  const [agents, setAgents] = useState<AgentWallet[]>([])
  const [stats, setStats] = useState<Stats>({ totalWalletBalance: 0, totalFundedToday: 0, lowBalanceCount: 0 })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [toastNode, toast] = useToast()

  // Fund wallet: form, then a review step
  const [showFund, setShowFund] = useState(false)
  const [fundStep, setFundStep] = useState<'form' | 'review' | 'done'>('form')
  const [fundDone, setFundDone] = useState<{ amount: number; name: string; agentId: string; before: number } | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [fundAmount, setFundAmount] = useState('')
  const [agentError, setAgentError] = useState('')
  const [amountError, setAmountError] = useState('')
  const [funding, setFunding] = useState(false)
  const [fundError, setFundError] = useState('')

  // Commission payout
  const [payoutTarget, setPayoutTarget] = useState<AgentWallet | null>(null)
  const [payingOut, setPayingOut] = useState(false)
  const [payoutError, setPayoutError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/wallets')
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<Stats> & { agents?: AgentWallet[] }
      setAgents(d.agents ?? [])
      setStats({
        totalWalletBalance: d.totalWalletBalance ?? 0,
        totalFundedToday: d.totalFundedToday ?? 0,
        lowBalanceCount: d.lowBalanceCount ?? 0,
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filter])

  const q = search.trim().toLowerCase()
  const matches = agents.filter(a => !q || a.name.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q) || a.location.toLowerCase().includes(q))
  const counts = {
    all: matches.length,
    low: matches.filter(a => a.walletBalance < LOW_BALANCE).length,
    commission: matches.filter(a => a.commissionBalance > 0).length,
  }
  const filtered = matches.filter(a => filter === 'all' ? true : filter === 'low' ? a.walletBalance < LOW_BALANCE : a.commissionBalance > 0)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? null
  const amountNum = parseFloat(fundAmount)

  function openFund(agentId = '') {
    setSelectedAgentId(agentId); setFundAmount(''); setFundStep('form')
    setAgentError(''); setAmountError(''); setFundError('')
    setShowFund(true)
  }

  function reviewFund() {
    let ok = true
    if (!selectedAgentId) { setAgentError('Choose the agent whose wallet you’re topping up.'); ok = false }
    if (!fundAmount || !(amountNum > 0)) { setAmountError('Enter an amount more than ₦0.'); ok = false }
    if (ok) { setFundError(''); setFundStep('review') }
  }

  async function handleFund() {
    if (!selectedAgent || !(amountNum > 0)) return
    setFunding(true); setFundError('')
    try {
      const res = await fetch('/api/admin/wallets/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgentId, amount: amountNum }),
      })
      if (!res.ok) { setFundError(await errorOf(res, 'The wallet wasn’t topped up. Nothing was added. Try again.')); return }
      setFundDone({ amount: amountNum, name: selectedAgent.name, agentId: selectedAgent.agentId, before: selectedAgent.walletBalance })
      setFundStep('done')
      load()
    } catch {
      setFundError('No connection. We can’t tell if the top-up went through, so check the agent’s balance before trying again.')
    } finally {
      setFunding(false)
    }
  }

  async function handleCommissionPayout() {
    if (!payoutTarget) return
    setPayingOut(true); setPayoutError('')
    try {
      const res = await fetch('/api/admin/wallets/commission-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: payoutTarget.id }),
      })
      if (!res.ok) { setPayoutError(await errorOf(res, 'The payout didn’t go through. Try again.')); return }
      const d = await res.json().catch(() => ({})) as { amount?: number }
      toast(`${naira(d.amount ?? payoutTarget.commissionBalance)} commission paid out to ${payoutTarget.name}`, 'success')
      setPayoutTarget(null)
      load()
    } catch {
      setPayoutError('No connection. We can’t tell if the payout went through, so reload the page before trying again.')
    } finally {
      setPayingOut(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Agent wallets"
        sub="Agents’ cash balances, commission owed and today’s top-ups."
        actions={<button type="button" className="btn btn-green" onClick={() => openFund()} disabled={loading && !agents.length}><Icons.add size={18} aria-hidden="true" /> Top up a wallet</button>}
      />

      <div className="stats-grid am-stats-3">
        <div className="stat">
          <div className="stat-lbl">Total in agent wallets</div>
          <div className="stat-val">{loading && !agents.length ? '—' : naira(stats.totalWalletBalance)}</div>
          <div className="stat-sub">Across all agents</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Topped up today</div>
          <div className="stat-val">{loading && !agents.length ? '—' : naira(stats.totalFundedToday)}</div>
          <div className="stat-sub">Admin top-ups since midnight</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Low balance</div>
          <div className={`stat-val${stats.lowBalanceCount ? ' amber' : ''}`}>{loading && !agents.length ? '—' : stats.lowBalanceCount.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Agents under {naira(LOW_BALANCE)}</div>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, agent ID or location" label="Search agents" />
        <Segmented<Filter> label="Filter wallets" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'low', label: 'Low balance', count: counts.low },
          { value: 'commission', label: 'Commission owed', count: counts.commission },
        ]} />
      </div>

      <section className="card" aria-label="Agent wallets">
        {loading && !agents.length ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="agent wallets" onRetry={load} />
          : filtered.length === 0 ? (
            q ? <Empty icon="search" title={`No agents match “${search.trim()}”`} text="Check the spelling, or search by agent ID or location." />
              : filter !== 'all' ? <Empty icon="check" title="Nothing here" text={filter === 'low' ? `No agent has less than ${naira(LOW_BALANCE)} right now.` : 'No agent is owed commission right now.'} />
              : <Empty icon="wallet" title="No agents yet" text="Agent wallets show here once agents are activated."
                  action={<Link href="/superadmin/agents" className="btn btn-outline">Go to agents</Link>} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th className="num">Wallet</th>
                      <th className="num">Float limit</th>
                      <th className="num">Commission owed</th>
                      <th>Last top-up</th>
                      <th className="num">Topped up today</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(a => {
                      const isLow = a.walletBalance < LOW_BALANCE
                      return (
                        <tr key={a.id}>
                          <td>
                            <Link href={`/superadmin/agents/${a.id}`} className="td-av am-link">
                              <Avatar name={a.name} photoUrl={a.photoUrl} tone={isLow ? 'amber' : 'green'} />
                              <span>
                                <span className="td-name ui-block">{a.name}</span>
                                <span className="td-sub ui-block">{a.agentId}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="num" data-label="Wallet">
                            <span className={isLow ? 'am-warn' : 'am-strong'}>{naira(a.walletBalance)}</span>
                            {isLow && <> <span className="bdg bdg-a">Low</span></>}
                          </td>
                          <td className="num am-muted" data-label="Float limit">{a.floatLimit != null ? naira(a.floatLimit) : '—'}</td>
                          <td className="num" data-label="Commission owed">{a.commissionBalance > 0 ? <span className="am-strong">{naira(a.commissionBalance)}</span> : <span className="am-muted">{naira(0)}</span>}</td>
                          <td className="am-muted am-nowrap" data-label="Last top-up">{a.lastFunded ? shortDate(a.lastFunded) : 'Never'}</td>
                          <td className="num" data-label="Topped up today">{a.todayActivity > 0 ? <span className="am-pos">+{naira(a.todayActivity)}</span> : <span className="am-muted">—</span>}</td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className={`btn btn-sm ${isLow ? 'btn-green' : 'btn-outline'}`} onClick={() => openFund(a.id)}
                                aria-label={`Top up ${a.name}’s wallet`}>Top up</button>
                              {a.commissionBalance > 0 && (
                                <button type="button" className="btn btn-sm btn-soft" onClick={() => { setPayoutError(''); setPayoutTarget(a) }}
                                  aria-label={`Pay out ${a.name}’s commission`}>Pay commission</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
            </>
          )}
      </section>

      {showFund && (
        <Modal error={fundError || undefined} icon={fundStep === 'done' ? undefined : 'wallet'} tone="money"
          title={fundStep === 'form' ? 'Top up an agent’s wallet' : fundStep === 'review' ? 'Check the top-up' : 'Wallet topped up'}
          sub={fundStep === 'form' ? 'The money is added to the agent’s wallet straight away.' : undefined}
          onClose={() => setShowFund(false)} busy={funding}
          footnote={fundStep === 'review' ? <><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</> : undefined}
          footer={fundStep === 'form' ? <>
            <button type="button" className="btn btn-outline" onClick={() => setShowFund(false)}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={reviewFund}>Continue</button>
          </> : fundStep === 'review' ? <>
            <button type="button" className="btn btn-outline" onClick={() => setFundStep('form')} disabled={funding}>Back</button>
            <button type="button" className="btn btn-green" onClick={handleFund} disabled={funding} aria-busy={funding}>{funding ? <><span className="a-spin" aria-hidden="true" /> Adding…</> : `Add ${naira(amountNum)}`}</button>
          </> : <>
            <button type="button" className="btn btn-outline" onClick={() => { setSelectedAgentId(''); setFundAmount(''); setFundDone(null); setFundStep('form') }}>Top up another</button>
            <button type="button" className="btn btn-green" onClick={() => setShowFund(false)}>Done</button>
          </>}>
          {fundStep === 'form' ? (
            <form onSubmit={e => { e.preventDefault(); reviewFund() }} noValidate>
              <Field id="fund-agent" label="Agent" error={agentError}>
                <select id="fund-agent" className="a-input" value={selectedAgentId} aria-invalid={!!agentError}
                  onChange={e => { setSelectedAgentId(e.target.value); setAgentError('') }}>
                  <option value="">Choose an agent</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.agentId})</option>)}
                </select>
              </Field>
              <Field id="fund-amount" label="Amount" error={amountError}
                hint={selectedAgent ? `${selectedAgent.name} has ${naira(selectedAgent.walletBalance)} now.` : undefined}>
                <div className="am-money">
                  <span aria-hidden="true">₦</span>
                  <input id="fund-amount" className="a-input" type="tel" inputMode="decimal" placeholder="50,000" autoComplete="off"
                    value={fundAmount} aria-invalid={!!amountError} onKeyDown={blockMinus}
                    onChange={e => { setFundAmount(nonNegativeString(e.target.value)); setAmountError('') }} />
                </div>
              </Field>
            </form>
          ) : fundStep === 'review' ? selectedAgent && (
            <>
              <AmountHero label="You’re adding" amount={naira(amountNum)} sub={<>to <strong>{selectedAgent.name}</strong> · {selectedAgent.agentId}</>} />
              <Ledger>
                <LedgerRow label="Wallet now">{naira(selectedAgent.walletBalance)}</LedgerRow>
                <LedgerRow label="Top-up">+ {naira(amountNum)}</LedgerRow>
                <LedgerRow label="Wallet after" total>{naira(selectedAgent.walletBalance + amountNum)}</LedgerRow>
              </Ledger>
              <DialogNote warn>This can’t be undone from here.</DialogNote>
            </>
          ) : fundDone && (
            <DialogDone title={`${naira(fundDone.amount)} added`}>
              {fundDone.name}’s wallet has been topped up.
              <Ledger>
                <LedgerRow label="Agent">{fundDone.name} · {fundDone.agentId}</LedgerRow>
                <LedgerRow label="Wallet before">{naira(fundDone.before)}</LedgerRow>
                <LedgerRow label="Wallet now" total>{naira(fundDone.before + fundDone.amount)}</LedgerRow>
              </Ledger>
            </DialogDone>
          )}
        </Modal>
      )}

      {payoutTarget && (
        <ConfirmModal icon="commission" tone="money"
          title={`Pay ${payoutTarget.name}’s commission?`}
          body={<>
            <dl className="dlg-ledger">
              <div><dt>Commission</dt><dd className="dlg-strong">{naira(payoutTarget.commissionBalance)}</dd></div>
              <div><dt>Agent</dt><dd>{payoutTarget.name} · {payoutTarget.agentId}</dd></div>
            </dl>
            <p className="dlg-note">The amount comes out of the Float wallet and their commission balance goes to {naira(0)}. No bank transfer is sent from here.</p>
          </>}
          confirmLabel={`Pay ${naira(payoutTarget.commissionBalance)}`}
          busy={payingOut} error={payoutError}
          onConfirm={handleCommissionPayout} onClose={() => setPayoutTarget(null)}
        />
      )}

      {toastNode}
    </>
  )
}
