'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons, type IconName } from '@/components/ui/icons'
import { AmountHero, DialogNote, ResultModal, type Result, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Segmented, naira, useToast } from '../_components/admin-ui'
import { AgentBalances } from '../_components/agent-balances'

interface PlatformWallet {
  id: string
  type: string
  balance: number
  updatedAt: string
}

interface Today {
  savings: number
  redemptions: number
  registrations: number
  walletFunding: number
  disbursements: number
  repayments: number
}

interface TreasuryData {
  wallets: PlatformWallet[]
  totalAgentFloat: number
  totalAgentCommission: number
  totalCustomerSavings: number
  lowBalanceAgents: number
  totalAgents: number
  agentsLoaded: boolean
  today: Today
}

interface WalletCard {
  key: string
  code: string
  label: string
  icon: IconName
  balance: number
  desc: string
  inactive?: boolean
  stats: { label: string; val?: string }[]
}

const EMPTY_TODAY: Today = { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 }
const LOW_BALANCE = 10000
// Display-only estimates of how today's savings split. They mirror the default commission rates in
// wallet-rates.ts (agent 0.4%, platform 1.6%); real splits depend on each plan's cadence and deposit method.
const EST_AGENT_RATE = 0.004
const EST_PLATFORM_RATE = 0.016
const EST_NET_RATE = 1 - EST_AGENT_RATE - EST_PLATFORM_RATE

const short = (n: number) => n >= 1_000_000 ? `₦${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `₦${(n / 1000).toFixed(0)}K` : naira(n)
const signed = (sign: '+' | '−', n: number) => n > 0 ? `${sign}${short(n)}` : '—'

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

type View = 'wallets' | 'agents'

export default function TreasuryPage() {
  const [view, setView] = useState<View>('wallets')
  const [data, setData] = useState<TreasuryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [toastNode, toast] = useToast()

  // Inject capital: form step, then a review step before money moves
  const [showInject, setShowInject] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [injectAmount, setInjectAmount] = useState('')
  const [injectRef, setInjectRef] = useState('')
  const [amountError, setAmountError] = useState('')
  const [injectError, setInjectError] = useState('')
  const [injecting, setInjecting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const [wRes, aRes] = await Promise.all([
        fetch('/api/admin/wallets/platform'),
        fetch('/api/admin/wallets').catch(() => null),
      ])
      if (!wRes.ok) throw new Error()
      const d = await wRes.json() as Partial<TreasuryData>
      let agents: { walletBalance: number }[] = []
      let agentsLoaded = false
      if (aRes?.ok) {
        const a = await aRes.json().catch(() => null) as { agents?: { walletBalance: number }[] } | null
        if (a) { agents = a.agents ?? []; agentsLoaded = true }
      }
      setData({
        wallets: d.wallets ?? [],
        totalAgentFloat: d.totalAgentFloat ?? 0,
        totalAgentCommission: d.totalAgentCommission ?? 0,
        totalCustomerSavings: d.totalCustomerSavings ?? 0,
        lowBalanceAgents: agents.filter(a => a.walletBalance < LOW_BALANCE).length,
        totalAgents: agents.length,
        agentsLoaded,
        today: d.today ?? EMPTY_TODAY,
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const w = (type: string) => data?.wallets.find(x => x.type === type)?.balance ?? 0
  const today = data?.today ?? EMPTY_TODAY
  const agentsKnown = !!data?.agentsLoaded

  function openInject() {
    setShowInject(true); setReviewing(false); setInjectAmount(''); setInjectRef(''); setAmountError(''); setInjectError('')
  }
  function closeInject() {
    if (injecting) return
    setShowInject(false); setReviewing(false)
  }

  function review() {
    const amt = parseFloat(injectAmount)
    if (!amt || amt <= 0) { setAmountError('Enter how much capital to add.'); return }
    setInjectError(''); setReviewing(true)
  }

  async function handleInject() {
    const amt = parseFloat(injectAmount)
    if (!amt || amt <= 0) { setReviewing(false); setAmountError('Enter how much capital to add.'); return }
    setInjecting(true); setInjectError('')
    try {
      const res = await fetch('/api/admin/wallets/inject-capital', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, reference: injectRef }),
      })
      if (!res.ok) { setInjectError(await errorOf(res, 'The capital wasn’t added. Nothing has changed. Try again.')); return }
      const before = capitalNow
      setShowInject(false); setReviewing(false); setInjectAmount(''); setInjectRef('')
      setResult({
        heading: 'Capital added', title: `${naira(amt)} added`,
        text: 'The capital wallet (W-1) has been credited and the injection is recorded in the audit log.',
        rows: [
          ...(injectRef.trim() ? [{ label: 'Your reference', value: injectRef.trim() }] : []),
          { label: 'Capital before', value: naira(before) },
          { label: 'Capital now', value: naira(before + amt), total: true },
        ],
      })
      load()
    } catch {
      setInjectError('No connection. We can’t tell if the capital was added. Refresh the page and check the capital wallet before trying again.')
    } finally {
      setInjecting(false)
    }
  }

  const wallets: WalletCard[] = [
    {
      key: 'capital', code: 'W-1', label: 'Capital wallet', icon: 'treasury',
      balance: w('Capital'), desc: 'Owner equity and investor capital.',
      stats: [
        { label: 'Agent wallets funded today', val: signed('+', today.walletFunding) },
        { label: 'Not used in the agent model' },
      ],
    },
    {
      key: 'float', code: 'W-2', label: 'Float wallet', icon: 'repay', inactive: true,
      balance: w('Float'), desc: 'Platform working capital pool.',
      stats: [
        { label: 'Agents', val: agentsKnown ? `${data?.totalAgents ?? 0}` : '—' },
        { label: 'Not used in the agent model' },
      ],
    },
    {
      key: 'agent', code: 'W-3', label: 'Agent float wallets', icon: 'wallet',
      balance: data?.totalAgentFloat ?? 0, desc: agentsKnown ? `Combined across ${data?.totalAgents ?? 0} agents.` : 'Combined across all agents.',
      stats: [
        { label: !agentsKnown ? 'Low-balance count unavailable' : data?.lowBalanceAgents ? `${data.lowBalanceAgents} under ${naira(LOW_BALANCE)}` : 'No agents low on float' },
        { label: 'Collections today (estimate)', val: signed('−', today.savings * EST_NET_RATE) },
      ],
    },
    {
      key: 'savings', code: 'W-4', label: 'Customer savings wallets', icon: 'plan',
      balance: data?.totalCustomerSavings ?? 0, desc: 'Individual customer savings in active plans.',
      stats: [
        { label: 'Saved today', val: signed('+', today.savings) },
        { label: 'Redeemed today', val: signed('−', today.redemptions) },
      ],
    },
    {
      key: 'pool', code: 'W-5', label: 'Savings pool', icon: 'deposit',
      balance: w('SavingsPool'), desc: 'What the platform owes customers in savings.',
      stats: [
        { label: 'In today (estimate)', val: signed('+', today.savings * EST_NET_RATE) },
        { label: 'Out today', val: signed('−', today.redemptions) },
      ],
    },
    {
      key: 'redemption', code: 'W-6', label: 'Redemption wallet', icon: 'redeem', inactive: true,
      balance: w('Redemption'), desc: 'Not used: agents pay customers directly from their float.',
      stats: [
        { label: 'Not active in the current model' },
        { label: 'Agent float backs payouts' },
      ],
    },
    {
      key: 'revenue', code: 'W-7', label: 'Revenue', icon: 'reports',
      balance: w('Revenue'), desc: 'Platform earnings from fees and charges.',
      stats: [
        { label: 'Earned today (estimate)', val: signed('+', today.savings * EST_PLATFORM_RATE) },
        { label: 'Total revenue', val: short(w('Revenue')) },
      ],
    },
    {
      key: 'commission', code: 'W-8', label: 'Agent commission', icon: 'commission',
      balance: data?.totalAgentCommission ?? 0, desc: 'Commission owed to agents, not yet paid out.',
      stats: [
        { label: 'Earned today (estimate)', val: signed('+', today.savings * EST_AGENT_RATE) },
        { label: 'Waiting to be paid', val: short(data?.totalAgentCommission ?? 0) },
      ],
    },
  ]

  const amt = parseFloat(injectAmount) || 0
  const capitalNow = w('Capital')
  // Solvency (moved here from the old Wallet accounts page).
  const platformTotal = (data?.wallets ?? []).reduce((sum, x) => sum + x.balance, 0)
  const totalAll = data ? platformTotal + data.totalAgentFloat + data.totalAgentCommission : 0
  const net = data ? data.totalAgentFloat - data.totalCustomerSavings : 0

  return (
    <>
      <PageHeader
        title="Treasury"
        sub="Agent-funded model: agent float (W-3) backs customer savings, revenue and commission."
        actions={view === 'wallets' ? <>
          <button type="button" className="btn btn-outline" onClick={load} disabled={loading}><Icons.retry size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="btn btn-green" onClick={openInject} disabled={!data}><Icons.add size={18} aria-hidden="true" /> Inject capital</button>
        </> : undefined}
      />

      <div className="toolbar">
        <Segmented<View> label="Show" value={view} onChange={setView} options={[
          { value: 'wallets', label: 'Wallets' },
          { value: 'agents', label: 'Agent balances' },
        ]} />
      </div>

      {view === 'agents' ? <AgentBalances /> : loading && !data ? (
        <div className="cm-wallets" aria-busy="true" aria-label="Loading wallets">
          {Array.from({ length: 8 }, (_, i) => <span key={i} className="skel cm-wallet-skel" />)}
        </div>
      ) : failed && !data ? (
        <section className="card"><LoadError what="the treasury wallets" onRetry={load} /></section>
      ) : (
        <>
          {failed && <p className="a-alert a-alert-a cm-gap" role="status">We couldn’t refresh the wallets. These figures may be out of date.</p>}
          <div className="cm-wallets">
            {wallets.map(card => {
              const Icon = Icons[card.icon]
              return (
                <article key={card.key} className={`cm-wallet${card.inactive ? ' is-inactive' : ''}`}>
                  <div className="cm-wallet-top">
                    <span className="cm-wallet-ic" aria-hidden="true"><Icon size={20} /></span>
                    <span className="cm-wallet-code">{card.code}</span>
                  </div>
                  <h3 className="cm-wallet-lbl">{card.label}</h3>
                  <div className="cm-wallet-val">{naira(card.balance)}</div>
                  <p className="cm-wallet-desc">{card.desc}</p>
                  <div className="cm-wallet-stats">
                    <dl>
                      {card.stats.map(s => (
                        <div key={s.label} className="cm-wallet-stat"><dt>{s.label}</dt>{s.val && <dd>{s.val}</dd>}</div>
                      ))}
                    </dl>
                  </div>
                </article>
              )
            })}
          </div>
          <p className="cm-foot">Figures marked estimate use the default 0.4% agent and 1.6% platform rates on today’s savings. Actual amounts depend on each plan.</p>

          {data && (
            <section className="card cm-solv-card" aria-labelledby="solv-hd">
              <div className="card-hd"><h3 id="solv-hd">Solvency</h3></div>
              <div className="cm-solv">
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Owed to customers</div>
                  <div className="cm-solv-val is-red">{naira(data.totalCustomerSavings)}</div>
                  <div className="cm-solv-sub">Customer savings in active plans</div>
                </div>
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Agent float backing it</div>
                  <div className={`cm-solv-val${data.totalAgentFloat >= data.totalCustomerSavings ? '' : ' is-amber'}`}>{naira(data.totalAgentFloat)}</div>
                  <div className="cm-solv-sub">Total in agent wallets</div>
                </div>
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Net position</div>
                  <div className={`cm-solv-val${net >= 0 ? '' : ' is-red'}`}>{net >= 0 ? '' : '−'}{naira(Math.abs(net))}</div>
                  <div className="cm-solv-sub">{net >= 0 ? 'Surplus: float covers what’s owed' : 'Deficit: float is short of what’s owed'}</div>
                </div>
              </div>
              <p className="cm-foot">Total system funds: <strong>{naira(totalAll)}</strong> (platform wallets, agent wallets and commission).</p>
            </section>
          )}
        </>
      )}

      {showInject && (
        <Modal error={injectError || undefined} icon="treasury" tone="money"
          title={reviewing ? 'Check and confirm' : 'Inject capital'}
          sub={reviewing ? 'This adds real money to the platform’s books.' : 'Money added here goes into the capital wallet (W-1).'}
          onClose={closeInject} busy={injecting}
          footnote={reviewing ? <><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</> : undefined}
          footer={reviewing ? <>
            <button type="button" className="btn btn-outline" onClick={() => setReviewing(false)} disabled={injecting}>Back</button>
            <button type="button" className="btn btn-green" onClick={handleInject} disabled={injecting}>{injecting ? <><span className="a-spin" aria-hidden="true" /> Adding…</> : `Add ${naira(amt)}`}</button>
          </> : <>
            <button type="button" className="btn btn-outline" onClick={closeInject}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={review}>Review</button>
          </>}>
          {!reviewing ? (
            <form onSubmit={e => { e.preventDefault(); review() }} noValidate>
              <Field id="inj-amount" label="Amount" error={amountError}>
                <div className="cm-money">
                  <span aria-hidden="true">₦</span>
                  <input id="inj-amount" className="a-input" type="tel" inputMode="decimal" placeholder="1,000,000" value={injectAmount} aria-invalid={!!amountError}
                    onKeyDown={blockMinus} onChange={e => { setInjectAmount(nonNegativeString(e.target.value)); setAmountError('') }} />
                </div>
              </Field>
              <Field id="inj-ref" label="Reference (optional)" hint="Like an invoice or transfer number. It’s saved with the injection in the audit log.">
                <input id="inj-ref" className="a-input" type="text" placeholder="INV-2025-001" value={injectRef} onChange={e => setInjectRef(e.target.value)} />
              </Field>
            </form>
          ) : (
            <>
              <AmountHero label="You’re adding" amount={naira(amt)} sub="to the capital wallet (W-1)" />
              <Ledger>
                <LedgerRow label="Capital now">{naira(capitalNow)}</LedgerRow>
                {injectRef.trim() && <LedgerRow label="Your reference">{injectRef.trim()}</LedgerRow>}
                <LedgerRow label="Capital after" total>{naira(capitalNow + amt)}</LedgerRow>
              </Ledger>
              <DialogNote warn>This can’t be undone from this page.</DialogNote>
            </>
          )}
        </Modal>
      )}

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {toastNode}
    </>
  )
}
