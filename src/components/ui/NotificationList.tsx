'use client'
// The full-screen list: New and Earlier, one plain sentence per item, the whole row opens what it's about.
// Opening it marks everything as seen, so the bell clears — there is nothing to manage.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons, type IconName } from '@/components/ui/icons'
import { timeLabel } from '@/lib/notifications'

/** Fired once the list has been marked seen, so the bell on the same screen clears at once. */
export const SEEN_EVENT = 'vochus:notifications-seen'

type Item = { id: string; kind: string; title: string; body: string | null; href: string | null; at: string; isNew: boolean }
type Tone = 'in' | 'out' | 'attention' | 'security'

const TONE: Record<string, [Tone, IconName]> = {
  saving_received: ['in', 'deposit'], online_saving_by_transfer: ['in', 'deposit'], wallet_funded: ['in', 'wallet'],
  collection_paid: ['in', 'cash'], collection_paid_agent: ['in', 'cash'], withdrawal_paid: ['in', 'cash'],
  collection_requested: ['out', 'redeem'], collection_wanted: ['out', 'redeem'], collection_approved: ['out', 'check'],
  collection_declined: ['attention', 'error'], collection_declined_agent: ['attention', 'error'], withdrawal_declined: ['attention', 'error'],
  plan_ending_soon: ['attention', 'calendar'], plan_ended: ['attention', 'calendar'], plans_ending_this_week: ['attention', 'calendar'],
  plan_uncollected: ['attention', 'cash'], uncollected_this_week: ['attention', 'cash'],
  ajo_joined: ['in', 'customers'], ajo_started: ['in', 'calendar'], ajo_paid: ['in', 'deposit'], ajo_paid_agent: ['in', 'deposit'],
  ajo_round_out: ['in', 'cash'], ajo_due: ['attention', 'calendar'], ajo_late: ['attention', 'calendar'], ajo_stopped: ['attention', 'error'], ajo_replaced: ['attention', 'customers'],
  new_phone: ['security', 'device'],
}

export default function NotificationList({ feedUrl }: { feedUrl: string }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(feedUrl, { cache: 'no-store', credentials: 'same-origin' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { items: Item[] }
      setItems(d.items)
      // Seen once shown. Best effort: if it fails, the bell just stays until next time.
      fetch(feedUrl, { method: 'POST', credentials: 'same-origin' })
        .then(r => { if (r.ok) window.dispatchEvent(new Event(SEEN_EVENT)) })
        .catch(() => {})
    } catch {
      setFailed(true)
    }
  }, [feedUrl])
  useEffect(() => { load() }, [load])

  if (failed) {
    return (
      <div className="nt-state" role="alert">
        <p className="nt-state-title">Couldn’t load your notifications</p>
        <p className="ui-row-sub">Check your connection and try again.</p>
        <button type="button" className="ui-btn ui-btn--primary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>
      </div>
    )
  }
  if (!items) {
    return <div className="nt-list" aria-busy="true" aria-label="Loading">{[0, 1, 2].map(i => <div key={i} className="nt-row nt-row--skel" />)}</div>
  }
  if (items.length === 0) {
    return (
      <div className="nt-state">
        <span className="nt-state-icon" aria-hidden="true"><Icons.bell size={28} /></span>
        <p className="nt-state-title">Nothing yet</p>
        <p className="ui-row-sub">We’ll show you here when money comes in or a plan changes.</p>
      </div>
    )
  }

  const now = new Date()
  const fresh = items.filter(i => i.isNew)
  const earlier = items.filter(i => !i.isNew)
  const group = (label: string, list: Item[]) => list.length > 0 && (
    <section className="nt-group" aria-label={label}>
      <h2 className="nt-group-title">{label}</h2>
      <ul className="nt-list">
        {list.map(i => {
          const [tone, icon] = TONE[i.kind] ?? (['out', 'pending'] as [Tone, IconName])
          const Icon = Icons[icon]
          const inner = (
            <>
              <span className={`nt-icon nt-icon--${tone}`} aria-hidden="true"><Icon size={20} /></span>
              <span className="nt-text">
                <span className="nt-title">{i.title}</span>
                {i.body && <span className="nt-body">{i.body}</span>}
                <span className="nt-time">{timeLabel(new Date(i.at), now)}</span>
              </span>
              {i.isNew && <span className="nt-dot" aria-label="New" />}
            </>
          )
          return (
            <li key={i.id}>
              {i.href ? <Link href={i.href} className={`nt-row${i.isNew ? ' is-new' : ''}`}>{inner}</Link> : <div className={`nt-row${i.isNew ? ' is-new' : ''}`}>{inner}</div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
  return <div className="nt-wrap">{group('New', fresh)}{group('Earlier', earlier)}</div>
}
