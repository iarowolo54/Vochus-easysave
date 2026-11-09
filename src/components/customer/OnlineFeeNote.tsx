'use client'
import { useEffect, useState } from 'react'
import { onlineFeeNote } from '@/lib/online-redeem-fee'

/** Tells someone opening an online plan what redeeming will cost. Shows nothing while there's no fee, or if it can't load. */
export default function OnlineFeeNote() {
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/online-redeem-fee/terms', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { maturedPct: number; earlyPct: number } | null) => { if (alive && d) setNote(onlineFeeNote(d.maturedPct, d.earlyPct)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return note ? <p className="ui-note">{note}</p> : null
}
