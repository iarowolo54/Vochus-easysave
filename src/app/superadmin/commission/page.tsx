'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, TableSkeleton, naira, nairaKobo, shortDate, useToast,
} from '../_components/admin-ui'
import { CommissionHistoryDrawer } from '../_components/commission-history-drawer'
import { FlexibleSavingsCard } from '../_components/flexible-savings-card'

interface LeaderboardEntry {
  rank: number
  id: string
  agentId: string
  name: string
  status: string
  customerCount: number
  savingsVolume: number
  commissionBalance: number
  photoUrl?: string | null
}

interface SystemCommission { savingsFees: number; loanShare: number; total: number }

interface PageData {
  totalPending: number
  totalDisbursed: number
  leaderboard: LeaderboardEntry[]
  systemCommission: SystemCommission
}

const TERMS = [30, 60, 90, 180] as const
type Term = typeof TERMS[number]
const TERM_LABELS: Record<Term, string> = { 30: 'Short term', 60: 'Standard', 90: 'Medium term', 180: 'Long term' }
const DEFAULT_RATES: Record<Term, number> = { 30: 5, 60: 8, 90: 12, 180: 18 }
const DEFAULT_COMM = { dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60, agentLoan: 1.0, agentRepay: 0.5, platformLoan: 5.0, platformPenalty: 2.0 }
type CommRates = typeof DEFAULT_COMM
type CommKey = keyof CommRates
type CommGroup = 'daily' | 'periodic' | 'loan' | 'unused'

const COMM_GROUPS: { key: CommGroup; title: string; sub: string; icon: 'customers' | 'treasury' | 'rate' }[] = [
  { key: 'daily', title: 'Daily plans', sub: 'The first day’s amount of each offline daily plan is the platform fee. Set how it splits.', icon: 'customers' },
  { key: 'periodic', title: 'Weekly and monthly plans', sub: 'A fee is taken from every deposit on offline plans. Set the fee and how it splits.', icon: 'treasury' },
  { key: 'loan', title: 'Loans', sub: 'Paid on loans and repayments.', icon: 'rate' },
  { key: 'unused', title: 'Not in use yet', sub: 'Saved, but nothing charges it today.', icon: 'rate' },
]

const FIRST_DAY = 500
const SAMPLE_DEPOSIT = 10000

const COMM_FIELDS: { key: CommKey; group: CommGroup; label: string; example: (v: number, all: Record<CommKey, number>) => string }[] = [
  { key: 'dailyFirstAgentPct', group: 'daily', label: 'Agent’s share of the first day’s amount', example: v => `On a ${nairaKobo(FIRST_DAY)} a day plan, the first ${nairaKobo(FIRST_DAY)} is the fee: the agent gets ${nairaKobo(FIRST_DAY * v / 100)} and the platform ${nairaKobo(FIRST_DAY * (100 - v) / 100)}.` },
  { key: 'periodicFeePct', group: 'periodic', label: 'Platform fee on each deposit', example: v => `On a ${nairaKobo(SAMPLE_DEPOSIT)} deposit the fee is ${nairaKobo(SAMPLE_DEPOSIT * v / 100)}. At most 25%.` },
  { key: 'periodicAgentPct', group: 'periodic', label: 'Agent’s share of that fee', example: (v, all) => `Of a ${nairaKobo(SAMPLE_DEPOSIT * all.periodicFeePct / 100)} fee the agent gets ${nairaKobo(SAMPLE_DEPOSIT * all.periodicFeePct / 100 * v / 100)} and the platform keeps the rest.` },
  { key: 'agentLoan', group: 'loan', label: 'Loan commission', example: v => `Per loan paid out. On a ₦50,000 loan the agent earns ${nairaKobo(500 * v)}.` },
  { key: 'agentRepay', group: 'loan', label: 'Repayment commission', example: v => `Per repayment. On ₦33,600 repaid the agent earns ${nairaKobo(336 * v)}.` },
  { key: 'platformLoan', group: 'loan', label: 'Platform share of loan interest', example: v => `Of interest earned. On ₦3,600 of interest the platform keeps ${nairaKobo(36 * v)}.` },
  { key: 'platformPenalty', group: 'unused', label: 'Late repayment penalty (not applied yet)', example: v => `Per day late. ₦50,000 overdue for 3 days would cost ${nairaKobo(50000 * v / 100 * 3)}.` },
]
const commLabel = (k: CommKey) => COMM_FIELDS.find(f => f.key === k)?.label ?? k

const PAGE_SIZE = 25

type Drafts<K extends string | number> = Record<K, string>
const toDrafts = <K extends string | number>(o: Record<K, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Drafts<K>
/** A loan tier's cap and on/off state. The POST is a full-state write, so both go back with every save. */
type Tier = { cap: number | null; on: boolean }
const DEFAULT_TIERS: Record<Term, Tier> = { 30: { cap: null, on: true }, 60: { cap: null, on: true }, 90: { cap: null, on: true }, 180: { cap: null, on: true } }
const capDrafts = (t: Record<Term, Tier>) => Object.fromEntries(TERMS.map(k => [k, t[k].cap === null ? '' : String(t[k].cap)])) as Drafts<Term>
/** Blank is no cap (null); otherwise a whole naira amount 0 or more. undefined = invalid. */
const capOf = (s: string): number | null | undefined => { if (s.trim() === '') return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : undefined }
/** A valid percentage 0–100, or null. */
const pct = (s: string) => { const n = parseFloat(s); return s.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null }

type Confirm =
  | { kind: 'comm' }
  | { kind: 'commReset' }
  | { kind: 'loan' }
  | { kind: 'savings' }
  | { kind: 'pay'; agent: LeaderboardEntry }

/** GET /api/admin/savings-interest: the current annual rate and its change history (forward-only). */
interface SavingsRateData { current: number; history: { effectiveFrom: string; annualRate: number }[] }

type BatchResult = { id: string; name: string; amount: number; ok: boolean; error?: string }

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function PctInput({ id, value, invalid, onChange, label }: { id: string; value: string; invalid: boolean; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="am-pct">
      <input id={id} className="a-input" type="tel" inputMode="decimal" autoComplete="off" value={value} aria-invalid={invalid} aria-label={label}
        onKeyDown={blockMinus} onChange={e => onChange(nonNegativeString(e.target.value))} />
      <span aria-hidden="true">%</span>
    </div>
  )
}

export default function CommissionPage() {
  const [ratePin, setRatePin] = useState('')
  const [data, setData] = useState<PageData>({ totalPending: 0, totalDisbursed: 0, leaderboard: [], systemCommission: { savingsFees: 0, loanShare: 0, total: 0 } })
  const [lbPage, setLbPage] = useState(1)
  const [historyAgent, setHistoryAgent] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [boardFailed, setBoardFailed] = useState(false)
  const [commFailed, setCommFailed] = useState(false)
  const [loanFailed, setLoanFailed] = useState(false)
  const [commLoaded, setCommLoaded] = useState(false)
  const [loanLoaded, setLoanLoaded] = useState(false)
  // Drafts are filled from the server once; later reloads (after a payout) mustn't wipe unsaved edits.
  const commInit = useRef(false)
  const loanInit = useRef(false)
  const [toastNode, toast] = useToast()

  const [savedComm, setSavedComm] = useState<CommRates>(DEFAULT_COMM)
  const [comm, setComm] = useState<Drafts<CommKey>>(toDrafts(DEFAULT_COMM))
  const [savedLoan, setSavedLoan] = useState<Record<Term, number>>({ ...DEFAULT_RATES })
  const [loanRates, setLoanRates] = useState<Drafts<Term>>(toDrafts(DEFAULT_RATES))
  const [savedTiers, setSavedTiers] = useState<Record<Term, Tier>>(DEFAULT_TIERS)
  const [loanCaps, setLoanCaps] = useState<Drafts<Term>>(capDrafts(DEFAULT_TIERS))
  const [loanOn, setLoanOn] = useState<Record<Term, boolean>>({ 30: true, 60: true, 90: true, 180: true })
  const [lastSavedComm, setLastSavedComm] = useState('')
  const [lastSavedLoan, setLastSavedLoan] = useState('')

  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const [savingsRate, setSavingsRate] = useState<SavingsRateData | null>(null)
  const [savingsRateFailed, setSavingsRateFailed] = useState(false)
  const [newSavingsRate, setNewSavingsRate] = useState('')

  const [batch, setBatch] = useState<{ step: 'confirm' | 'running' | 'done'; results: BatchResult[] } | null>(null)

  const nowStr = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const load = useCallback(async () => {
    setLoading(true); setBoardFailed(false); setCommFailed(false); setLoanFailed(false)
    const get = (url: string) => fetch(url).then(r => r.ok ? r.json() as Promise<unknown> : null).catch(() => null)
    const [commD, ratesD, commRatesD] = await Promise.all([
      get('/api/admin/commission'),
      get('/api/admin/interest-rates'),
      get('/api/admin/commission/rates'),
    ])

    const board = commD as Partial<PageData> | null
    setBoardFailed(!board)
    if (board) setData({ totalPending: board.totalPending ?? 0, totalDisbursed: board.totalDisbursed ?? 0, leaderboard: board.leaderboard ?? [], systemCommission: board.systemCommission ?? { savingsFees: 0, loanShare: 0, total: 0 } })

    const loan = ratesD as { rates?: { durationDays: number; rate: number; maxAmount?: number | null; enabled?: boolean }[] } | null
    setLoanFailed(!loan || !Array.isArray(loan.rates))
    if (loan && Array.isArray(loan.rates)) {
      const next: Record<Term, number> = { ...DEFAULT_RATES }
      const tiers: Record<Term, Tier> = { ...DEFAULT_TIERS }
      loan.rates.forEach(r => {
        if (!(TERMS as readonly number[]).includes(r.durationDays)) return
        next[r.durationDays as Term] = r.rate
        tiers[r.durationDays as Term] = { cap: typeof r.maxAmount === 'number' ? r.maxAmount : null, on: r.enabled !== false }
      })
      setSavedLoan(next); setSavedTiers(tiers); setLoanLoaded(true)
      if (!loanInit.current) {
        loanInit.current = true
        setLoanRates(toDrafts(next)); setLoanCaps(capDrafts(tiers))
        setLoanOn(Object.fromEntries(TERMS.map(t => [t, tiers[t].on])) as Record<Term, boolean>)
      }
    }

    const cr = commRatesD as { rates?: Partial<CommRates> } | null
    setCommFailed(!cr)
    if (cr) {
      const next = { ...DEFAULT_COMM, ...(cr.rates ?? {}) }
      setSavedComm(next); setCommLoaded(true)
      if (!commInit.current) { commInit.current = true; setComm(toDrafts(next)) }
    }
    setLoading(false)
  }, [])

  const loadSavingsRate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/savings-interest')
      if (!res.ok) throw new Error()
      setSavingsRate(await res.json() as SavingsRateData)
      setSavingsRateFailed(false)
    } catch { setSavingsRateFailed(true) }
  }, [])

  useEffect(() => { load(); loadSavingsRate() }, [load, loadSavingsRate])

  async function handleSetSavingsRate() {
    const rate = pct(newSavingsRate)
    if (rate === null) { setConfirmError('Enter a rate from 0 to 100.'); return }
    setBusy(true); setConfirmError('')
    try {
      const res = await fetch('/api/admin/savings-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annualRate: rate }),
      })
      if (!res.ok) { setConfirmError(await errorOf(res, 'The rate wasn’t changed. Try again.')); return }
      setConfirm(null); setNewSavingsRate('')
      toast(`Savings interest is now ${rate}% a year`, 'success')
      await loadSavingsRate()
    } catch {
      setConfirmError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  // Commission rates: parsed drafts, validity and what changed
  const commParsed = Object.fromEntries(COMM_FIELDS.map(f => [f.key, pct(comm[f.key])])) as Record<CommKey, number | null>
  const commValid = COMM_FIELDS.every(f => commParsed[f.key] !== null)
  const commChanges = COMM_FIELDS.filter(f => commParsed[f.key] !== savedComm[f.key])
  const valOr = (k: CommKey) => commParsed[k] ?? savedComm[k]
  const effectiveLoanCost = (valOr('agentLoan') + valOr('platformLoan')).toFixed(1)

  const loanParsed = Object.fromEntries(TERMS.map(t => [t, pct(loanRates[t])])) as Record<Term, number | null>
  const capParsed = Object.fromEntries(TERMS.map(t => [t, capOf(loanCaps[t])])) as Record<Term, number | null | undefined>
  const loanValid = TERMS.every(t => loanParsed[t] !== null && capParsed[t] !== undefined)
  const loanChanges = TERMS.filter(t => loanParsed[t] !== savedLoan[t] || capParsed[t] !== savedTiers[t].cap || loanOn[t] !== savedTiers[t].on)
  const capText = (c: number | null | undefined) => c == null ? 'No cap' : naira(c)
  const maxLoanRate = Math.max(...TERMS.map(t => loanParsed[t] ?? 0))

  const owed = data.leaderboard.filter(a => a.commissionBalance > 0)
  const owedTotal = owed.reduce((s, a) => s + a.commissionBalance, 0)

  function openConfirm(c: Confirm) { setConfirmError(''); setConfirm(c) }

  async function saveCommRates(rates: CommRates, done: string) {
    setBusy(true); setConfirmError('')
    try {
      const res = await fetch('/api/admin/commission/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates, pin: ratePin }) })
      if (!res.ok) { setConfirmError(await errorOf(res, 'The rates weren’t saved. Nothing changed. Try again.')); return }
      setSavedComm(rates); setComm(toDrafts(rates))
      setLastSavedComm(`Saved at ${nowStr()}`)
      setConfirm(null); setRatePin('')
      toast(done, 'success')
    } catch {
      setConfirmError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveLoanRates() {
    if (!loanValid) return
    setBusy(true); setConfirmError('')
    // Full-state write: a row sent without maxAmount/enabled is reset, so every tier sends both.
    const rates = TERMS.map(d => ({ durationDays: d, rate: loanParsed[d] as number, maxAmount: capParsed[d] ?? null, enabled: loanOn[d] }))
    try {
      const res = await fetch('/api/admin/interest-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      })
      if (!res.ok) { setConfirmError(await errorOf(res, 'The loan rates weren’t saved. Nothing changed. Try again.')); return }
      const next = Object.fromEntries(rates.map(r => [r.durationDays, r.rate])) as Record<Term, number>
      setSavedLoan(next)
      setSavedTiers(Object.fromEntries(rates.map(r => [r.durationDays, { cap: r.maxAmount, on: r.enabled }])) as Record<Term, Tier>)
      setLastSavedLoan(`Saved at ${nowStr()}`)
      setConfirm(null)
      toast('Loan interest rates saved. New loan requests use them from now on.', 'success')
    } catch {
      setConfirmError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function payOne(agentId: string) {
    const res = await fetch('/api/admin/wallets/commission-payout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    if (!res.ok) return { ok: false as const, error: await errorOf(res, 'Payout failed') }
    const d = await res.json().catch(() => ({})) as { amount?: number }
    return { ok: true as const, amount: d.amount }
  }

  async function handlePayout(a: LeaderboardEntry) {
    setBusy(true); setConfirmError('')
    try {
      const r = await payOne(a.id)
      if (!r.ok) { setConfirmError(r.error); return }
      setConfirm(null)
      toast(`${naira(r.amount ?? a.commissionBalance)} commission paid out to ${a.name}`, 'success')
      load()
    } catch {
      setConfirmError('No connection. We can’t tell if the payout went through, so reload before trying again.')
    } finally {
      setBusy(false)
    }
  }

  // One at a time, so SQLite isn't hit with parallel writes and each result is clear.
  async function runBatch() {
    const targets = owed
    setBatch({ step: 'running', results: [] })
    const results: BatchResult[] = []
    for (const a of targets) {
      try {
        const r = await payOne(a.id)
        results.push(r.ok ? { id: a.id, name: a.name, amount: r.amount ?? a.commissionBalance, ok: true } : { id: a.id, name: a.name, amount: a.commissionBalance, ok: false, error: r.error })
      } catch {
        results.push({ id: a.id, name: a.name, amount: a.commissionBalance, ok: false, error: 'No connection' })
      }
      setBatch({ step: 'running', results: [...results] })
    }
    setBatch({ step: 'done', results })
    load()
  }

  const firstLoad = loading && !data.leaderboard.length && !boardFailed
  const paidCount = batch?.results.filter(r => r.ok).length ?? 0
  const paidSum = batch?.results.filter(r => r.ok).reduce((s, r) => s + r.amount, 0) ?? 0
  const failedResults = batch?.results.filter(r => !r.ok) ?? []

  return (
    <>
      <PageHeader
        title="Commission"
        sub="Set what agents and the platform earn, set loan interest, and pay agents what they’re owed."
        actions={<button type="button" className="btn btn-green" disabled={!owed.length || loading} onClick={() => setBatch({ step: 'confirm', results: [] })}>
          <Icons.commission size={18} aria-hidden="true" /> Pay all owed commission
        </button>}
      />

      <div className="stats-grid am-stats-4">
        <div className="stat">
          <div className="stat-lbl">Total commission earned</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.totalPending + data.totalDisbursed)}</div>
          <div className="stat-sub">{data.leaderboard.length.toLocaleString('en-NG')} agents</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Waiting to be paid</div>
          <div className={`stat-val${data.totalPending > 0 ? ' amber' : ''}`}>{firstLoad ? '—' : naira(data.totalPending)}</div>
          <div className="stat-sub">{owed.length.toLocaleString('en-NG')} agent{owed.length === 1 ? '' : 's'} owed</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Paid out</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.totalDisbursed)}</div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">System commission</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.systemCommission.total)}</div>
          <div className="stat-sub">Platform fees: new ones recorded, earlier collections worked out</div>
        </div>
      </div>

      {/* Commission rates */}
      <section className="card am-section" aria-labelledby="comm-h">
        <div className="card-hd">
          <div>
            <h3 id="comm-h">Commission rates</h3>
            <p className="am-card-sub">Used for every new savings deposit, loan and repayment on offline plans.</p>
          </div>
        </div>
        {!commLoaded ? (commFailed ? <LoadError what="commission rates" onRetry={load} /> : <TableSkeleton rows={3} cols={3} />)
          : (
            <>
              <div className="am-rate-groups">
                {COMM_GROUPS.map(group => (
                  <div key={group.key} className="am-rate-group">
                    <div className="am-rate-group-hd">
                      <span className="row-ic" aria-hidden="true">{group.icon === 'customers' ? <Icons.customers size={18} /> : group.icon === 'treasury' ? <Icons.treasury size={18} /> : <Icons.rate size={18} />}</span>
                      <div>
                        <h4>{group.title}</h4>
                        <p>{group.sub}</p>
                      </div>
                    </div>
                    {COMM_FIELDS.filter(f => f.group === group.key).map(f => {
                      const v = commParsed[f.key]
                      const all = Object.fromEntries(COMM_FIELDS.map(g => [g.key, valOr(g.key)])) as Record<CommKey, number>
                      return (
                        <Field key={f.key} id={`c-${f.key}`} label={f.label} error={v === null ? 'Enter a rate from 0 to 100.' : undefined} hint={f.example(v ?? 0, all)}>
                          <PctInput id={`c-${f.key}`} value={comm[f.key]} invalid={v === null} onChange={s => setComm(c => ({ ...c, [f.key]: s }))} />
                        </Field>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="am-foot">
                <div className="am-foot-info">
                  <span>Online daily, weekly and monthly plans pay no fee.</span>
                  <span>Loan cost to customer: <strong>{effectiveLoanCost}%</strong></span>
                  {lastSavedComm && <span>{lastSavedComm}</span>}
                </div>
                <div className="am-foot-actions">
                  <button type="button" className="btn btn-outline" onClick={() => openConfirm({ kind: 'commReset' })}>Reset to defaults</button>
                  <button type="button" className="btn btn-green" disabled={!commValid || commChanges.length === 0} onClick={() => openConfirm({ kind: 'comm' })}>
                    {commChanges.length === 0 ? 'No changes' : 'Save changes'}
                  </button>
                </div>
              </div>
            </>
          )}
      </section>

      <FlexibleSavingsCard />

      {/* Loan interest */}
      <section className="card am-section" aria-labelledby="loan-h">
        <div className="card-hd">
          <div>
            <h3 id="loan-h">Loan interest rates</h3>
            <p className="am-card-sub">Interest charged on each loan length.</p>
          </div>
        </div>
        {!loanLoaded ? (loanFailed ? <LoadError what="loan interest rates" onRetry={load} /> : <TableSkeleton rows={2} cols={4} />)
          : (
            <>
              <div className="am-terms">
                {TERMS.map(term => {
                  const rate = loanParsed[term]
                  const interest = 50000 * (rate ?? 0) / 100
                  const capBad = capParsed[term] === undefined
                  return (
                    <div key={term} className={`am-term${loanOn[term] ? '' : ' am-term--off'}`}>
                      <div className="am-term-hd am-term-hd--row">
                        <div><strong>{term} days</strong><span>{TERM_LABELS[term]}</span></div>
                        <label className="cs-check">
                          <input type="checkbox" checked={loanOn[term]} onChange={e => setLoanOn(o => ({ ...o, [term]: e.target.checked }))} />
                          <span>Offered<span className="sr-only"> for {term} day loans</span></span>
                        </label>
                      </div>
                      <Field id={`lr-${term}`} label="Interest rate" error={rate === null ? 'Enter 0 to 100.' : undefined}>
                        <PctInput id={`lr-${term}`} value={loanRates[term]} invalid={rate === null} onChange={s => setLoanRates(r => ({ ...r, [term]: s }))} />
                      </Field>
                      <Field id={`lc-${term}`} label="Largest loan" hint={capBad ? undefined : 'Larger requests are refused. Leave blank for no cap.'} error={capBad ? 'Enter an amount, or leave blank.' : undefined}>
                        <div className="am-money">
                          <span aria-hidden="true">₦</span>
                          <input id={`lc-${term}`} className="a-input" type="tel" inputMode="numeric" autoComplete="off" placeholder="No cap" value={loanCaps[term]} aria-invalid={capBad || undefined}
                            onKeyDown={blockMinus} onChange={e => { const v = e.target.value.replace(/\D/g, ''); setLoanCaps(c => ({ ...c, [term]: v })) }} />
                        </div>
                      </Field>
                      <p className="am-term-eg">{loanOn[term]
                        ? <>A ₦50,000 loan is repaid as <strong>{naira(50000 + interest)}</strong>, which is {naira(interest)} interest over {term} days.</>
                        : <>Turned off. New loan requests for {term} days are refused.</>}</p>
                    </div>
                  )
                })}
              </div>

              <div className="am-bars" aria-label="Rate comparison">
                <p className="am-bars-h">Compared</p>
                {TERMS.map(term => (
                  <div key={term} className="am-bar-row">
                    <span className="am-bar-lbl">{term} days</span>
                    <div className="progress-bar" aria-hidden="true">
                      <div className="progress-fill" style={{ width: `${maxLoanRate > 0 ? ((loanParsed[term] ?? 0) / maxLoanRate) * 100 : 0}%` }} />
                    </div>
                    <span className="am-bar-val">{loanParsed[term] ?? '—'}%</span>
                  </div>
                ))}
              </div>

              <div className="am-foot">
                <div className="am-foot-info">
                  <span>New loan requests use these rates. Loans already approved keep the rate they were given.</span>
                  {lastSavedLoan && <span>{lastSavedLoan}</span>}
                </div>
                <div className="am-foot-actions">
                  <button type="button" className="btn btn-outline" onClick={() => { setLoanRates(toDrafts(DEFAULT_RATES)); toast('Default rates filled in. Save to apply them.') }}>Use defaults</button>
                  <button type="button" className="btn btn-green" disabled={!loanValid || loanChanges.length === 0} onClick={() => openConfirm({ kind: 'loan' })}>
                    {loanChanges.length === 0 ? 'No changes' : 'Save loan rates'}
                  </button>
                </div>
              </div>
            </>
          )}
      </section>

      {/* Savings interest (online plans) */}
      <section className="card am-section" aria-labelledby="si-h">
        <div className="card-hd">
          <div>
            <h3 id="si-h">Savings interest rate</h3>
            <p className="am-card-sub">Paid to online customers on their savings. Cash (agent) plans don’t earn interest.</p>
          </div>
          {savingsRate && <span className="am-rate-now">{savingsRate.current}% <span>a year</span></span>}
        </div>
        {!savingsRate ? (savingsRateFailed ? <LoadError what="the savings interest rate" onRetry={loadSavingsRate} /> : <TableSkeleton rows={2} cols={2} />)
          : (
            <>
              <div className="am-terms">
                <div className="am-term">
                  <Field id="si-new" label="New rate (% a year)" error={newSavingsRate !== '' && pct(newSavingsRate) === null ? 'Enter 0 to 100.' : undefined}>
                    <PctInput id="si-new" value={newSavingsRate} invalid={newSavingsRate !== '' && pct(newSavingsRate) === null} onChange={setNewSavingsRate} />
                  </Field>
                  <p className="am-term-eg">At {pct(newSavingsRate) ?? savingsRate.current}% a year, ₦100,000 held for a month earns <strong>{naira(100000 * (pct(newSavingsRate) ?? savingsRate.current) / 100 / 12)}</strong>.</p>
                </div>
                <div className="am-term">
                  <div className="am-term-hd"><strong>Rate history</strong></div>
                  {savingsRate.history.length === 0
                    ? <p className="am-term-eg">No changes yet. The default of {savingsRate.current}% applies.</p>
                    : (
                      <dl className="dlg-ledger">
                        {[...savingsRate.history].reverse().slice(0, 6).map(h => (
                          <div key={h.effectiveFrom + h.annualRate}><dt>From {shortDate(h.effectiveFrom)}</dt><dd>{h.annualRate}%</dd></div>
                        ))}
                      </dl>
                    )}
                </div>
              </div>
              <div className="am-foot">
                <div className="am-foot-info"><span>Applies from now on. Interest already earned isn’t changed.</span></div>
                <div className="am-foot-actions">
                  <button type="button" className="btn btn-green" disabled={pct(newSavingsRate) === null || pct(newSavingsRate) === savingsRate.current}
                    onClick={() => openConfirm({ kind: 'savings' })}>Set rate</button>
                </div>
              </div>
            </>
          )}
      </section>

      {/* Commission by agent */}
      <section className="card" aria-labelledby="lb-h">
        <div className="card-hd">
          <div>
            <h3 id="lb-h">Commission by agent</h3>
            <p className="am-card-sub">Ranked by commission owed now. Savings volume is all time.</p>
          </div>
        </div>
        {firstLoad ? <TableSkeleton rows={6} cols={6} />
          : boardFailed && !data.leaderboard.length ? <LoadError what="agent commission" onRetry={load} />
          : data.leaderboard.length === 0 ? <Empty icon="customers" title="No agents yet" text="Agents and the commission they earn will show here."
              action={<Link href="/superadmin/agents" className="btn btn-outline">Go to agents</Link>} />
          : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>Agent</th><th className="num">Customers</th><th className="num">Savings volume</th><th className="num">Commission owed</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.slice((lbPage - 1) * PAGE_SIZE, lbPage * PAGE_SIZE).map(a => {
                      const hasPending = a.commissionBalance > 0
                      return (
                        <tr key={a.id}>
                          <td>
                            <button type="button" className="cm-cell-btn" onClick={() => setHistoryAgent(a)}
                              aria-label={`View commission history for ${a.name}`} title="View commission history">
                              <span className="am-rank" aria-label={`Rank ${a.rank}`}>{a.rank}</span>
                              <Avatar name={a.name} photoUrl={a.photoUrl} tone={hasPending ? 'amber' : 'green'} />
                              <span>
                                <span className="td-name ui-block">{a.name}</span>
                                <span className="td-sub ui-block">{a.agentId}</span>
                              </span>
                            </button>
                          </td>
                          <td className="num" data-label="Customers">{a.customerCount.toLocaleString('en-NG')}</td>
                          <td className="num" data-label="Savings volume">{naira(a.savingsVolume)}</td>
                          <td className="num am-strong" data-label="Commission owed">{naira(a.commissionBalance)}</td>
                          <td data-label="Status"><span className={`bdg ${hasPending ? 'bdg-a' : 'bdg-g'}`}>{hasPending ? 'Owed' : 'Paid up'}</span></td>
                          <td>
                            {hasPending && (
                              <div className="a-row-actions">
                                <button type="button" className="btn btn-sm btn-soft" onClick={() => openConfirm({ kind: 'pay', agent: a })}
                                  aria-label={`Pay ${naira(a.commissionBalance)} to ${a.name}`}>Pay</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={lbPage} pageSize={PAGE_SIZE} total={data.leaderboard.length} onPage={setLbPage} />
            </>
          )}
      </section>

      {historyAgent && (
        <CommissionHistoryDrawer agent={{ id: historyAgent.id, name: historyAgent.name, agentId: historyAgent.agentId }} onClose={() => setHistoryAgent(null)} />
      )}

      {confirm?.kind === 'comm' && (
        <ConfirmModal icon="rate" title="Save commission rates?" confirmLabel="Save rates" busy={busy} error={confirmError}
          body={<>
            These apply to every agent, from the next transaction. Transactions already made don’t change.
            <ul className="am-diff">
              {commChanges.map(f => (
                <li key={f.key}><span>{f.label}</span><span className="am-diff-val"><span className="am-diff-old">{savedComm[f.key]}%</span>{commParsed[f.key]}%</span></li>
              ))}
            </ul>
            <Field id="rate-pin" label="Your approval PIN">
              <input id="rate-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={ratePin} onChange={e => setRatePin(e.target.value)} />
            </Field>
          </>}
          onConfirm={() => saveCommRates(Object.fromEntries(COMM_FIELDS.map(f => [f.key, commParsed[f.key] as number])) as CommRates, 'Commission rates saved')}
          onClose={() => setConfirm(null)} />
      )}

      {confirm?.kind === 'commReset' && (
        <ConfirmModal title="Reset commission rates to defaults?" confirmLabel="Reset and save" danger busy={busy} error={confirmError}
          body={<>
            This saves the default rates straight away, for every agent.
            <ul className="am-diff">
              {COMM_FIELDS.map(f => (
                <li key={f.key}><span>{commLabel(f.key)}</span><span className="am-diff-val">{savedComm[f.key] !== DEFAULT_COMM[f.key] && <span className="am-diff-old">{savedComm[f.key]}%</span>}{DEFAULT_COMM[f.key]}%</span></li>
              ))}
            </ul>
            <Field id="rate-pin" label="Your approval PIN">
              <input id="rate-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={ratePin} onChange={e => setRatePin(e.target.value)} />
            </Field>
          </>}
          onConfirm={() => saveCommRates(DEFAULT_COMM, 'Commission rates reset to defaults')}
          onClose={() => setConfirm(null)} />
      )}

      {confirm?.kind === 'loan' && (
        <ConfirmModal icon="rate" title="Save loan interest rates?" confirmLabel="Save loan rates" busy={busy} error={confirmError}
          body={<>
            New loan requests use these rates. Loans already approved keep their rate.
            <ul className="am-diff">
              {loanChanges.flatMap(t => [
                loanParsed[t] !== savedLoan[t] && <li key={`${t}-r`}><span>{t} days rate</span><span className="am-diff-val"><span className="am-diff-old">{savedLoan[t]}%</span>{loanParsed[t]}%</span></li>,
                capParsed[t] !== savedTiers[t].cap && <li key={`${t}-c`}><span>{t} days largest loan</span><span className="am-diff-val"><span className="am-diff-old">{capText(savedTiers[t].cap)}</span>{capText(capParsed[t])}</span></li>,
                loanOn[t] !== savedTiers[t].on && <li key={`${t}-o`}><span>{t} days</span><span className="am-diff-val"><span className="am-diff-old">{savedTiers[t].on ? 'Offered' : 'Off'}</span>{loanOn[t] ? 'Offered' : 'Off'}</span></li>,
              ].filter(Boolean))}
            </ul>
          </>}
          onConfirm={handleSaveLoanRates} onClose={() => setConfirm(null)} />
      )}

      {confirm?.kind === 'savings' && savingsRate && (
        <ConfirmModal icon="rate" title="Change the savings interest rate?" confirmLabel="Set rate" busy={busy} error={confirmError}
          body={<>
            Online customers earn the new rate from now on. Interest already earned isn’t changed.
            <ul className="am-diff">
              <li><span>Annual rate</span><span className="am-diff-val"><span className="am-diff-old">{savingsRate.current}%</span>{pct(newSavingsRate)}%</span></li>
            </ul>
          </>}
          onConfirm={handleSetSavingsRate} onClose={() => setConfirm(null)} />
      )}

      {confirm?.kind === 'pay' && (
        <ConfirmModal icon="commission" tone="money" title={`Pay ${confirm.agent.name}’s commission?`} confirmLabel={`Pay ${naira(confirm.agent.commissionBalance)}`} busy={busy} error={confirmError}
          body={<>
            <dl className="dlg-ledger">
              <div><dt>Commission</dt><dd className="dlg-strong">{naira(confirm.agent.commissionBalance)}</dd></div>
              <div><dt>Agent</dt><dd>{confirm.agent.name} · {confirm.agent.agentId}</dd></div>
            </dl>
            <p className="dlg-note">The amount comes out of the Float wallet and their commission balance goes to {naira(0)}. No bank transfer is sent from here.</p>
          </>}
          onConfirm={() => handlePayout(confirm.agent)} onClose={() => setConfirm(null)} />
      )}

      {batch && (
        <Modal icon="commission" tone="money" title={batch.step === 'done' ? 'Payouts finished' : 'Pay all owed commission?'} onClose={() => setBatch(null)} busy={batch.step === 'running'}
          footer={batch.step === 'confirm' ? <>
            <button type="button" className="btn btn-outline" onClick={() => setBatch(null)}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={runBatch}>Pay {naira(owedTotal)} to {owed.length} agent{owed.length === 1 ? '' : 's'}</button>
          </> : batch.step === 'running' ? (
            <button type="button" className="btn btn-green" disabled>Paying {batch.results.length + 1} of {owed.length}…</button>
          ) : <button type="button" className="btn btn-green" onClick={() => setBatch(null)}>Done</button>}>
          {batch.step === 'confirm' && (
            <>
              <dl className="dlg-ledger">
                <div><dt>Total</dt><dd className="dlg-strong">{naira(owedTotal)}</dd></div>
                <div><dt>Agents</dt><dd>{owed.length}</dd></div>
              </dl>
              <p className="dlg-note">Each agent is paid in turn from the Float wallet and their commission balance goes to {naira(0)}. No bank transfers are sent from here. If the Float wallet runs out, the rest won’t be paid.</p>
              <ul className="am-batch">
                {owed.map(a => <li key={a.id}><span>{a.name}</span><span className="am-diff-val">{naira(a.commissionBalance)}</span></li>)}
              </ul>
            </>
          )}
          {batch.step !== 'confirm' && (
            <>
              <p className="dlg-note" role="status">
                {batch.step === 'running' ? `Paid ${paidCount} so far. Keep this open until it finishes.`
                  : `Paid ${naira(paidSum)} to ${paidCount} of ${batch.results.length} agent${batch.results.length === 1 ? '' : 's'}.`}
              </p>
              {batch.step === 'done' && failedResults.length > 0 && (
                <>
                  <p className="a-alert a-alert-r" role="alert">{failedResults.length} payout{failedResults.length === 1 ? '' : 's'} didn’t go through. Fix the reason below, then pay them one by one.</p>
                  <ul className="am-batch">
                    {failedResults.map(r => <li key={r.id} className="is-failed"><span>{r.name}</span><span>{r.error}</span></li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {toastNode}
    </>
  )
}
