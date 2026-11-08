'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import CodeBoxes from '@/components/ui/CodeBoxes'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'

type Preview = {
  id: string; name: string; cadence: string; size: number; contribution: number; pot: number; startDate: string
  firstRound: string; lastRound: string; agentName: string; memberCount: number; full: boolean; alreadyIn: boolean
}
type MyGroup = {
  id: string; name: string; cadence: string; size: number; contribution: number; status: string; currentRound: number | null; memberCount: number
  me: { memberId: string; slot: number | null } | null
  rounds: { round: number; label: string; paidMemberIds: string[] }[]
}

const EVERY: Record<string, string> = { daily: 'every day', weekly: 'every week', monthly: 'every month' }
const naira = (n: number) => formatNaira(n, Number.isInteger(n) ? { minor: false } : {})

function statusOf(g: MyGroup): [string, string] {
  if (g.status === 'Forming') return ['Waiting to start', 'ui-status--warn']
  if (g.status === 'Completed') return ['Finished', 'ui-status--neutral']
  const open = g.currentRound ? g.rounds[g.currentRound - 1] : null
  if (open && g.me && !open.paidMemberIds.includes(g.me.memberId)) return ['Payment due', 'ui-status--danger']
  return ['Paid this turn', 'ui-status--success']
}

export default function GroupAjoPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<MyGroup[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [looking, setLooking] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/customer/ajo', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroups(((await res.json()) as { groups: MyGroup[] }).groups)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  async function lookUp(value: string) {
    if (looking) return
    setLooking(true); setError(''); setPreview(null)
    try {
      const res = await fetch(`/api/customer/ajo/preview?code=${encodeURIComponent(value)}`, { cache: 'no-store' })
      const d: { group?: Preview; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !d.group) { setError(d.error ?? 'Couldn’t find that group. Try again.'); return }
      setPreview(d.group)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setLooking(false)
    }
  }

  async function join() {
    if (joining) return
    setJoining(true); setError('')
    try {
      const res = await fetch('/api/customer/ajo/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const d: { groupId?: string; error?: string } = await res.json().catch(() => ({}))
      if (d.groupId) { router.push(`/customer/ajo/${d.groupId}`); return }
      setError(d.error ?? 'You weren’t added. Try again.')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        <button type="button" className="ui-icon-btn" onClick={() => router.push('/customer/dashboard')} aria-label="Back to Home">
          <Icons.back size={22} aria-hidden="true" />
        </button>
        <div className="ui-topbar-main"><h1 className="ui-topbar-title">Group Ajo</h1></div>
      </header>
      <main className="ui-container">
        <section className="ui-card">
          <h2 className="ui-row-title">Join a group</h2>
          <p className="ui-row-sub">Enter the 6-digit code from your agent.</p>
          <div className="ui-gap-top">
            <CodeBoxes value={code} label="Group code" errorId="ajo-code-error"
              onChange={v => { setCode(v); setPreview(null); setError(''); if (v.length === 6) void lookUp(v) }} />
          </div>
          {looking && <p className="ui-note ui-note--center"><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Looking for the group…</p>}
          {error && <p className="ui-field-error" id="ajo-code-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}

          {preview && (
            <div className="ui-gap-top">
              <dl className="ui-review-rows ag-ajo-review">
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">Group</dt><dd className="ui-review-value">{preview.name}</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">You pay</dt><dd className="ui-review-value">{naira(preview.contribution)} {EVERY[preview.cadence]}</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">You collect once</dt><dd className="ui-review-value">{naira(preview.pot)}</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">Runs</dt><dd className="ui-review-value">{preview.firstRound} to {preview.lastRound}</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">First payment</dt><dd className="ui-review-value">{formatDate(preview.startDate)}</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">Members</dt><dd className="ui-review-value">{preview.memberCount} of {preview.size} joined</dd></div>
                <div className="ui-row"><dt className="ui-row-main ui-row-sub">Agent</dt><dd className="ui-review-value">{preview.agentName}</dd></div>
              </dl>
              {preview.alreadyIn
                ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={() => router.push(`/customer/ajo/${preview.id}`)}>You’re in this group. Open it</button>
                : preview.full
                  ? <p className="ui-note ui-note--center">This group is full.</p>
                  : <>
                      <p className="ui-note">Your agent gives you your turn to collect. Once the group starts, you can’t leave it, and you pay every turn until the last one.</p>
                      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={join} disabled={joining} aria-busy={joining}>{joining ? 'Joining…' : 'Join the group'}</button>
                    </>}
            </div>
          )}
        </section>

        {failed && !groups ? (
          <section className="ui-card ui-gap-top"><EmptyState icon="error" tone="danger" title="Couldn’t load your groups" text="Check your connection and try again."
            action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}>Try again</button>} /></section>
        ) : !groups ? <div className="ui-gap-top"><ListSkeleton count={2} /></div>
        : groups.length > 0 && (
          <>
            <div className="ui-section-head ui-gap-top"><h2>Your groups</h2></div>
            <div className="ui-card ui-card--list">
              {groups.map(g => {
                const [label, cls] = statusOf(g)
                return <ListRow key={g.id} icon="team" title={g.name} sub={`${naira(g.contribution)} ${EVERY[g.cadence] ?? ''}`}
                  value={<span className={`ui-status ui-status--sm ${cls}`}>{label}</span>} onClick={() => router.push(`/customer/ajo/${g.id}`)} />
              })}
            </div>
          </>
        )}
      </main>
      <CustomerBottomNav />
    </div>
  )
}
