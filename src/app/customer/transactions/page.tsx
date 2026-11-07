'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import DepositReceipt, { depositIcon, depositMethod, methodShort, signedAmount, txMeta, txStatus } from '@/components/customer/DepositReceipt'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Bone } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import { getHideBalance, setHideBalance } from '@/lib/preferences'
import { saveReceiptImage, shareReceiptImage } from '@/lib/receipt-image'

type Tx = {
  id: string; ref: string; type: string; amount: number; feeTaken?: number
  method: string | null; status: string; createdAt: string
  planGoal?: string | null
  cadence?: string | null
  confirmedByStaff?: boolean
}
type Me = { transactions: { id: string; recordedBy: string }[] }

type Group = 'all' | 'saving' | 'collection' | 'loan' | 'other'
const GROUP_LABEL: Record<Exclude<Group, 'all'>, string> = { saving: 'Savings', collection: 'Collections', loan: 'Loans', other: 'Other' }

function groupOf(type: string): Exclude<Group, 'all'> {
  if (type === 'saving') return 'saving'
  if (type === 'redemption') return 'collection'
  if (type === 'disbursement' || type === 'repayment') return 'loan'
  return 'other'
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const PAGE_SIZE = 30

export default function TransactionsPage() {
  const router = useRouter()
  // /me is used for who recorded each deposit (agent names), and handles the logged-out redirect.
  const me = useCustomerMe<Me>()
  const [txs, setTxs] = useState<Tx[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [group, setGroup] = useState<Group>('all')
  const [plan, setPlan] = useState<string>('all')
  const [planSheet, setPlanSheet] = useState(false)
  const [selected, setSelected] = useState<Tx | null>(null)
  const [hide, setHide] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)

  useEffect(() => { setHide(getHideBalance()) }, [])

  const load = useCallback(() => {
    setFailed(false)
    setTxs(null)
    fetch('/api/customer/transactions')
      .then(r => {
        if (r.status === 401) { router.push('/customer/login'); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (d) setTxs(d.transactions ?? []) })
      .catch(() => setFailed(true))
  }, [router])

  useEffect(() => { load() }, [load])

  // A notice links here with ?ref=<reference>: open that receipt once the list arrives, then drop the ref from the
  // address so going back or refreshing doesn't open it again.
  const [linkedRef, setLinkedRef] = useState<string | null>(null)
  useEffect(() => { setLinkedRef(new URLSearchParams(window.location.search).get('ref')) }, [])
  useEffect(() => {
    if (!linkedRef || !txs) return
    const hit = txs.find(t => t.ref === linkedRef)
    if (hit) setSelected(hit)
    setLinkedRef(null)
    window.history.replaceState(null, '', window.location.pathname)
  }, [linkedRef, txs])
  useEffect(() => { setShown(PAGE_SIZE) }, [group, plan])

  const recordedBy = useMemo(
    () => new Map((me.data?.transactions ?? []).map(t => [t.id, t.recordedBy])),
    [me.data],
  )
  const all = txs ?? []
  const groupsPresent = useMemo(() => [...new Set(all.map(t => groupOf(t.type)))], [all])
  const plansPresent = useMemo(() => [...new Set(all.map(t => t.planGoal).filter((g): g is string => !!g))], [all])

  const filtered = all.filter(t =>
    (group === 'all' || groupOf(t.type) === group) && (plan === 'all' || t.planGoal === plan),
  )
  const sections = useMemo(() => {
    const out: { label: string; items: Tx[] }[] = []
    for (const t of filtered.slice(0, shown)) {
      const label = dayLabel(t.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(t)
      else out.push({ label, items: [t] })
    }
    return out
  }, [filtered, shown])

  const now = new Date()
  const savedThisMonth = all
    .filter(t => t.type === 'saving' && (plan === 'all' || t.planGoal === plan))
    .filter(t => { const d = new Date(t.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
    .reduce((s, t) => s + t.amount, 0)
  const monthName = now.toLocaleDateString('en-GB', { month: 'long' })

  function toggleHide() {
    setHideBalance(!hide)
    setHide(!hide)
  }

  function receiptData(tx: Tx) {
    const meta = txMeta(tx.type)
    return {
      title: meta.label,
      amount: signedAmount(tx),
      status: txStatus(tx.status).label,
      reference: tx.ref,
      rows: [
        ['Date', `${formatDate(tx.createdAt)}, ${formatTime(tx.createdAt)}`],
        ...(tx.planGoal ? [[meta.planLabel, tx.planGoal] as [string, string]] : []),
        ['Method', depositMethod({ method: tx.method, recordedBy: recordedBy.get(tx.id), confirmedByStaff: tx.confirmedByStaff })],
        ...(tx.feeTaken ? [['Platform fee', `−${formatNaira(tx.feeTaken)}`] as [string, string]] : []),
      ] as [string, string][],
    }
  }

  function download(tx: Tx) {
    saveReceiptImage(receiptData(tx))
  }

  const header = (
    <header className="ui-topbar">
      <div className="ui-topbar-main"><h1 className="ui-page-title">History</h1></div>
      <button type="button" className="ui-icon-btn ui-icon-btn--plain" onClick={toggleHide} aria-label={hide ? 'Show amounts' : 'Hide amounts'} aria-pressed={hide}>
        {hide ? <Icons.show size={20} aria-hidden="true" /> : <Icons.hide size={20} aria-hidden="true" />}
      </button>
    </header>
  )

  if (failed) return (
    <div className="ui-screen">
      {header}
      <EmptyState
        icon="error"
        tone="danger"
        title="We couldn't load your history"
        text="Check your connection and try again."
        action={<button type="button" className="ui-btn ui-btn--primary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>}
      />
      <CustomerBottomNav />
    </div>
  )

  return (
    <div className="ui-screen">
      {header}
      <main className="ui-container">
        {txs === null ? (
          <div className="ui-skeleton" role="status" aria-busy="true" aria-label="Loading your history">
            <div className="ui-card"><Bone w="40%" h={14} /><span style={{ height: 10, display: 'block' }} /><Bone w="55%" h={28} /></div>
            <Bone w={90} h={14} />
            <span style={{ height: 10, display: 'block' }} />
            <div className="ui-card ui-card--list">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="ui-row"><Bone w={40} h={40} round /><span className="ui-row-main ui-bone-lines"><Bone w="50%" /><Bone w="35%" h={12} /></span><Bone w={70} /></div>
              ))}
            </div>
          </div>
        ) : all.length === 0 ? (
          <EmptyState icon="history" title="No transactions yet" text="Your savings and collections will show up here." />
        ) : (
          <>
            <section className="ui-card ui-month-summary" aria-label={`Saved in ${monthName}`}>
              <span className="ui-row-sub">Saved in {monthName}{plan !== 'all' ? ` · ${plan}` : ''}</span>
              <span className="ui-amount ui-month-amount">{hide ? '₦ ••••' : formatNaira(savedThisMonth)}</span>
            </section>

            <div className="ui-filter-bar">
              <div className="ui-chips" role="group" aria-label="Show">
                <button type="button" className="ui-chip" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>All</button>
                {(['saving', 'collection', 'loan', 'other'] as const).filter(g => groupsPresent.includes(g)).map(g => (
                  <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g]}</button>
                ))}
              </div>
              {plansPresent.length > 1 && (
                <button type="button" className="ui-plan-picker ui-filter-plan" onClick={() => setPlanSheet(true)} aria-haspopup="dialog">
                  <span className="ui-plan-picker-label">{plan === 'all' ? 'All plans' : plan}</span>
                  <Icons.expand size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon="history"
                title="Nothing here"
                text="No transactions match this filter."
                action={<button type="button" className="ui-btn ui-btn--secondary" onClick={() => { setGroup('all'); setPlan('all') }}>Show everything</button>}
              />
            ) : (
              sections.map(sec => (
                <section key={sec.label} aria-label={sec.label}>
                  <h2 className="ui-date-head">{sec.label}</h2>
                  <div className="ui-card ui-card--list">
                    {sec.items.map(tx => {
                      const meta = txMeta(tx.type)
                      const status = txStatus(tx.status)
                      const amountText = hide ? '₦ ••••' : tx.amount > 0 ? signedAmount(tx) : '—'
                      return (
                        <ListRow
                          key={tx.id}
                          icon={depositIcon(tx)}
                          title={meta.label}
                          sub={[
                            formatTime(tx.createdAt),
                            methodShort(tx.method),
                            plansPresent.length > 1 && plan === 'all' ? tx.planGoal : null,
                          ].filter(Boolean).join(' · ')}
                          value={
                            <span className="ui-value-stack">
                              <span className={meta.direction === 'in' && !hide ? 'ui-amount--positive' : undefined}>{amountText}</span>
                              {status.tone !== 'success' && <span className={`ui-status ui-status--${status.tone} ui-status--sm`}>{status.label}</span>}
                            </span>
                          }
                          onClick={() => setSelected(tx)}
                        />
                      )
                    })}
                  </div>
                </section>
              ))
            )}
            {filtered.length > shown && (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => setShown(n => n + PAGE_SIZE)}>
                Show more ({filtered.length - shown} older)
              </button>
            )}
          </>
        )}
      </main>

      <BottomSheet open={planSheet} onClose={() => setPlanSheet(false)} title="Show plan">
        <div>
          {['all', ...plansPresent].map(p => (
            <button
              key={p}
              type="button"
              className="ui-option"
              aria-current={plan === p ? 'true' : undefined}
              onClick={() => { setPlan(p); setPlanSheet(false) }}
            >
              <span className="ui-row-main"><span className="ui-row-title ui-block">{p === 'all' ? 'All plans' : p}</span></span>
              <span className="ui-option-check" aria-hidden="true">{plan === p && <Icons.check size={20} />}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Receipt">
        {selected && (
          <DepositReceipt
            tx={{ ...selected, recordedBy: recordedBy.get(selected.id) }}
            planName={selected.planGoal}
            hideAmounts={hide}
            onHelp={() => router.push(`/customer/chat?ref=${encodeURIComponent(selected.ref)}`)}
            onDownload={() => download(selected)}
            onShare={() => shareReceiptImage(receiptData(selected))}
          />
        )}
      </BottomSheet>

      <CustomerBottomNav />
    </div>
  )
}
