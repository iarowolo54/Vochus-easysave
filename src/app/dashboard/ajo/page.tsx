'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatNaira } from '@/lib/format'

type Group = { id: string; name: string; cadence: string; size: number; contribution: number; pot: number; status: string; memberCount: number; paidOutRounds: number }

const EVERY: Record<string, string> = { daily: 'a day', weekly: 'a week', monthly: 'a month' }
const STATUS: Record<string, [string, string]> = {
  Forming: ['Getting members', 'ui-status--warn'], Running: ['Running', 'ui-status--success'],
  Completed: ['Finished', 'ui-status--neutral'], Cancelled: ['Cancelled', 'ui-status--neutral'], Stopped: ['Stopped', 'ui-status--neutral'],
}

export default function AjoGroupsPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/agent/ajo', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroups(((await res.json()) as { groups: Group[] }).groups)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const newButton = <Link href="/dashboard/ajo/new" className="ui-btn ui-btn--primary ui-btn--block"><Icons.add size={18} aria-hidden="true" /> New group</Link>

  return (
    <div className="ag-page">
      {failed && !groups ? (
        <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your groups" text="Check your connection and try again."
          action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}>Try again</button>} /></section>
      ) : !groups ? <ListSkeleton count={3} />
      : groups.length === 0 ? (
        <section className="ui-card">
          <EmptyState icon="team" title="No Ajo groups yet" text="Start a group, share its code, and members take turns collecting the pot." action={newButton} />
        </section>
      ) : (
        <>
          {newButton}
          <div className="ui-card ui-card--list ui-gap-top">
            {groups.map(g => {
              const [label, cls] = STATUS[g.status] ?? [g.status, 'ui-status--neutral']
              const progress = g.status === 'Forming' ? `${g.memberCount} of ${g.size} members` : g.status === 'Running' ? `${g.paidOutRounds} of ${g.size} paid out` : `${g.size} members`
              return (
                <ListRow key={g.id} icon="team" title={g.name} sub={`${formatNaira(g.contribution, { minor: false })} ${EVERY[g.cadence] ?? ''} · ${progress}`}
                  value={<span className={`ui-status ui-status--sm ${cls}`}>{label}</span>} onClick={() => router.push(`/dashboard/ajo/${g.id}`)} />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
