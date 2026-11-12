'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import TransferPanel, { type TransferDetails } from '@/components/ui/TransferPanel'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { PhotoNoticeWithCamera, photoPaused, useMyPhoto } from '@/components/customer/PhotoReminder'

type Group = {
  id: string; name: string; cadence: string; size: number; contribution: number; pot: number; feePct: number; platformFee: number; startDate: string
  status: string; currentRound: number | null; memberCount: number
  me: { memberId: string; slot: number | null; payoutPlanId: string | null } | null
  members: { id: string; name: string; slot: number | null; isMe: boolean }[]
  rounds: { round: number; label: string; dueDay: string; holderId: string | null; paidMemberIds: string[]; paidOut: boolean }[]
}

const EVERY: Record<string, string> = { daily: 'every day', weekly: 'every week', monthly: 'every month' }
const naira = (n: number) => formatNaira(n, Number.isInteger(n) ? { minor: false } : {})
const dayText = (day: string) => formatDate(new Date(`${day}T12:00:00+01:00`))

export default function CustomerAjoGroupPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [group, setGroup] = useState<Group | null>(null)
  const [failed, setFailed] = useState(false)
  const [transfer, setTransfer] = useState<TransferDetails | null>(null)
  const [starting, setStarting] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  const { photo, reload: reloadPhoto } = useMyPhoto()

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(`/api/customer/ajo/${id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroup(((await res.json()) as { group: Group }).group)
    } catch { setFailed(true) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function pay() {
    if (starting) return
    setStarting(true); setError('')
    try {
      const res = await fetch(`/api/customer/ajo/${id}/transfer`, { method: 'POST' })
      const d: TransferDetails & { error?: string } = await res.json().catch(() => ({}) as TransferDetails & { error?: string })
      if (!res.ok) { setError(d.error ?? 'Couldn’t start the payment. Try again.'); return }
      setTransfer(d)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setStarting(false)
    }
  }

  async function leave() {
    setLeaving(true); setError('')
    try {
      const res = await fetch(`/api/customer/ajo/${id}/leave`, { method: 'POST' })
      if (res.ok) { router.replace('/customer/ajo'); return }
      const d: { error?: string } = await res.json().catch(() => ({}))
      setError(d.error ?? 'You weren’t removed. Try again.')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setLeaving(false)
    }
  }

  const header = (
    <header className="ui-topbar">
      <button type="button" className="ui-icon-btn" onClick={() => (transfer ? setTransfer(null) : router.push('/customer/ajo'))} aria-label="Back">
        <Icons.back size={22} aria-hidden="true" />
      </button>
      <div className="ui-topbar-main"><h1 className="ui-topbar-title">{group?.name ?? 'Group Ajo'}</h1></div>
    </header>
  )

  if (failed && !group) {
    return <div className="ui-screen">{header}<main className="ui-container"><section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load this group" text="Check your connection and try again."
      action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}>Try again</button>} /></section></main><CustomerBottomNav /></div>
  }
  if (!group) return <div className="ui-screen">{header}<main className="ui-container"><ListSkeleton count={4} /></main><CustomerBottomNav /></div>

  const g = group
  const open = g.currentRound ? g.rounds[g.currentRound - 1] : null
  const iPaid = !!open && !!g.me && open.paidMemberIds.includes(g.me.memberId)
  const myRound = g.me?.slot ? g.rounds[g.me.slot - 1] : null
  const nameOf = (memberId: string | null) => g.members.find(m => m.id === memberId)?.name

  if (transfer && open) {
    return (
      <div className="ui-screen">
        {header}
        <main className="ui-container">
          <TransferPanel
            details={transfer}
            statusUrl="/api/customer/transfer/status"
            cancelUrl="/api/customer/transfer/cancel"
            reportUrl="/api/customer/transfer/report-kobo"
            destination={`${g.name}, ${open.label}`}
            balanceLabel="Your balance"
            doneHref={`/customer/ajo/${g.id}`}
            historyHref="/customer/transactions"
            onDone={() => { void load() }}
            onClose={() => setTransfer(null)}
          />
        </main>
        <CustomerBottomNav />
      </div>
    )
  }

  return (
    <div className="ui-screen">
      {header}
      <main className="ui-container">
        <section className="ui-card">
          <p className="ui-row-sub">You pay {naira(g.contribution)} {EVERY[g.cadence]}</p>
          <p className="ag-ajo-pot">{naira(g.pot - g.platformFee)}</p>
          {g.feePct > 0 && <p className="ui-row-sub">After a {g.feePct}% Platform Fee of {naira(g.platformFee)}</p>}
          <p className="ui-row-sub">{myRound ? `You redeem in ${myRound.label}` : g.me ? 'Your agent will set your turn before the group starts' : ''}</p>
        </section>

        {g.status === 'Forming' && (
          <section className="ui-card ui-gap-top">
            <p className="ui-row-title">{g.memberCount} of {g.size} members have joined</p>
            <p className="ui-row-sub">We’ll tell you when the group starts. The first payment is due {dayText(g.rounds[0].dueDay)}.</p>
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block ui-gap-top" onClick={() => { setError(''); setLeaveOpen(true) }}>Leave this group</button>
          </section>
        )}

        {open && (
          <>
            <div className="ui-section-head ui-gap-top"><h2>{open.label}</h2></div>
            <section className="ui-card">
              <p className="ui-row-title">{open.paidMemberIds.length} of {g.size} have paid</p>
              <p className="ui-row-sub">Due {dayText(open.dueDay)}{open.holderId ? ` · ${open.holderId === g.me?.memberId ? 'You redeem' : `${nameOf(open.holderId)} redeems`} when everyone has paid` : ''}</p>
              <div className="ui-progress ag-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={g.size} aria-valuenow={open.paidMemberIds.length} aria-label={`${open.paidMemberIds.length} of ${g.size} paid`}>
                <span style={{ width: `${(open.paidMemberIds.length / g.size) * 100}%` }} />
              </div>
              {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
              {iPaid
                ? <p className="ui-note ui-note--center"><Icons.check size={16} aria-hidden="true" /> You’ve paid this turn.</p>
                : photoPaused(photo)
                  ? <div className="ui-gap-top"><PhotoNoticeWithCamera photo={photo} onChanged={reloadPhoto} /></div>
                  : <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={pay} disabled={starting} aria-busy={starting}>{starting ? 'Getting the details…' : `Pay ${naira(g.contribution)}`}</button>}
            </section>
          </>
        )}

        {g.status === 'Completed' && <section className="ui-card ui-gap-top"><EmptyState icon="check" title="This group has finished" text="Every member has had their turn." /></section>}

        {g.status !== 'Forming' && (
          <>
            <div className="ui-section-head ui-gap-top"><h2>All turns</h2></div>
            <div className="ui-card ui-card--list">
              {g.rounds.map(r => {
                const state = r.paidOut ? ['Paid out', 'ui-status--success'] : r.round === g.currentRound ? ['Open', 'ui-status--warn'] : ['Waiting', 'ui-status--neutral']
                return <ListRow key={r.round} icon="calendar" title={r.label} sub={r.holderId ? (r.holderId === g.me?.memberId ? 'You redeem' : `${nameOf(r.holderId)} redeems`) : undefined}
                  value={<span className={`ui-status ui-status--sm ${state[1]}`}>{state[0]}</span>} />
              })}
            </div>
            {g.me?.payoutPlanId && <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={() => router.push(`/customer/redeem?planId=${encodeURIComponent(g.me!.payoutPlanId!)}`)}>Redeem my Ajo money</button>}
          </>
        )}

        {g.status === 'Forming' && g.members.length > 0 && (
          <>
            <div className="ui-section-head ui-gap-top"><h2>Members</h2></div>
            <div className="ui-card ui-card--list">
              {g.members.map(m => <ListRow key={m.id} icon="customers" title={m.isMe ? `${m.name} (you)` : m.name} />)}
            </div>
          </>
        )}
      </main>

      <BottomSheet open={leaveOpen} onClose={() => { if (!leaving) setLeaveOpen(false) }} title="Leave this group?">
        <p className="ui-note">You can join again with the code until the group starts.</p>
        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={leave} disabled={leaving} aria-busy={leaving}>{leaving ? 'Leaving…' : 'Leave the group'}</button>
      </BottomSheet>
      <CustomerBottomNav />
    </div>
  )
}
