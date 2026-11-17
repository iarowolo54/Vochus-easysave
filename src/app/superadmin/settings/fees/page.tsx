'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Field, LoadError, PageHeader, TableSkeleton, nairaKobo, useToast } from '../../_components/admin-ui'
import { FlexibleSavingsCard } from '../../_components/flexible-savings-card'
import { OnlineRedeemFeeCard } from '../../_components/online-redeem-fee-card'
import { PctInput, errorOf, nowStr, pct, toDrafts, type Drafts } from '../../_components/rate-fields'

// Settings → Fees & commission: what agents and the platform take on savings, loans and early redemptions.
// Same permission as before the move (commission); what agents have earned stays on Agents → Commission.

const DEFAULT_COMM = { dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60, agentLoan: 1.0, agentRepay: 0.5, platformLoan: 5.0, platformPenalty: 2.0 }
type CommRates = typeof DEFAULT_COMM
type CommKey = keyof CommRates
type CommGroup = 'daily' | 'periodic' | 'loan' | 'unused'

const COMM_GROUPS: { key: CommGroup; title: string; sub: string; icon: 'customers' | 'treasury' | 'rate' }[] = [
  { key: 'daily', title: 'Daily plans', sub: 'One day’s amount each month of every offline daily plan is the platform fee. Set how it splits.', icon: 'customers' },
  { key: 'periodic', title: 'Weekly and monthly plans', sub: 'A fee is taken from every deposit on offline plans. Set the fee and how it splits.', icon: 'treasury' },
  { key: 'loan', title: 'Loans', sub: 'Paid on loans and repayments.', icon: 'rate' },
  { key: 'unused', title: 'Not in use yet', sub: 'Saved, but nothing charges it today.', icon: 'rate' },
]

const FIRST_DAY = 500
const SAMPLE_DEPOSIT = 10000

const COMM_FIELDS: { key: CommKey; group: CommGroup; label: string; example: (v: number, all: Record<CommKey, number>) => string }[] = [
  { key: 'dailyFirstAgentPct', group: 'daily', label: 'Agent’s share of each month’s first day', example: v => `On a ${nairaKobo(FIRST_DAY)} a day plan, the first ${nairaKobo(FIRST_DAY)} saved each month is the fee: the agent gets ${nairaKobo(FIRST_DAY * v / 100)} and the platform ${nairaKobo(FIRST_DAY * (100 - v) / 100)}.` },
  { key: 'periodicFeePct', group: 'periodic', label: 'Platform fee on each deposit', example: v => `On a ${nairaKobo(SAMPLE_DEPOSIT)} deposit the fee is ${nairaKobo(SAMPLE_DEPOSIT * v / 100)}. At most 25%.` },
  { key: 'periodicAgentPct', group: 'periodic', label: 'Agent’s share of that fee', example: (v, all) => `Of a ${nairaKobo(SAMPLE_DEPOSIT * all.periodicFeePct / 100)} fee the agent gets ${nairaKobo(SAMPLE_DEPOSIT * all.periodicFeePct / 100 * v / 100)} and the platform keeps the rest.` },
  { key: 'agentLoan', group: 'loan', label: 'Loan commission', example: v => `Per loan paid out. On a ₦50,000 loan the agent earns ${nairaKobo(500 * v)}.` },
  { key: 'agentRepay', group: 'loan', label: 'Repayment commission', example: v => `Per repayment. On ₦33,600 repaid the agent earns ${nairaKobo(336 * v)}.` },
  { key: 'platformLoan', group: 'loan', label: 'Platform share of loan interest', example: v => `Of interest earned. On ₦3,600 of interest the platform keeps ${nairaKobo(36 * v)}.` },
  { key: 'platformPenalty', group: 'unused', label: 'Late repayment penalty (not applied yet)', example: v => `Per day late. ₦50,000 overdue for 3 days would cost ${nairaKobo(50000 * v / 100 * 3)}.` },
]
const commLabel = (k: CommKey) => COMM_FIELDS.find(f => f.key === k)?.label ?? k

type Confirm = { kind: 'comm' } | { kind: 'commReset' }

export default function FeesSettingsPage() {
  const [ratePin, setRatePin] = useState('')
  const [commFailed, setCommFailed] = useState(false)
  const [commLoaded, setCommLoaded] = useState(false)
  // Drafts are filled from the server once; a retry after a failure mustn't wipe unsaved edits.
  const commInit = useRef(false)
  const [toastNode, toast] = useToast()
  const [savedComm, setSavedComm] = useState<CommRates>(DEFAULT_COMM)
  const [comm, setComm] = useState<Drafts<CommKey>>(toDrafts(DEFAULT_COMM))
  const [lastSavedComm, setLastSavedComm] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const load = useCallback(async () => {
    setCommFailed(false)
    const cr = await fetch('/api/admin/commission/rates').then(r => r.ok ? r.json() as Promise<{ rates?: Partial<CommRates> }> : null).catch(() => null)
    setCommFailed(!cr)
    if (cr) {
      const next = { ...DEFAULT_COMM, ...(cr.rates ?? {}) }
      setSavedComm(next); setCommLoaded(true)
      if (!commInit.current) { commInit.current = true; setComm(toDrafts(next)) }
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Commission rates: parsed drafts, validity and what changed
  const commParsed = Object.fromEntries(COMM_FIELDS.map(f => [f.key, pct(comm[f.key])])) as Record<CommKey, number | null>
  const commValid = COMM_FIELDS.every(f => commParsed[f.key] !== null)
  const commChanges = COMM_FIELDS.filter(f => commParsed[f.key] !== savedComm[f.key])
  const valOr = (k: CommKey) => commParsed[k] ?? savedComm[k]
  const effectiveLoanCost = (valOr('agentLoan') + valOr('platformLoan')).toFixed(1)

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

  return (
    <>
      <PageHeader title="Fees & commission" sub="What agents and the platform take on savings, loans and early redemptions." />

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
      <OnlineRedeemFeeCard />

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

      {toastNode}
    </>
  )
}
