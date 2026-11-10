'use client'
import { useEffect, useState } from 'react'

interface PlanDays { days: { key: string; label: string }[]; perSlot: number; weekly: boolean }

/** Which unpaid day (or week) of the plan held money pays for. Choosing none keeps the normal rule: it counts for today. */
export default function DayChoice({ planId, amount, value, onChange }: {
  planId: string
  amount: number
  value: string[]
  onChange: (days: string[]) => void
}) {
  const [data, setData] = useState<PlanDays | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setFailed(false)
    fetch(`/api/admin/bank-transfers/plan-days?planId=${encodeURIComponent(planId)}`)
      .then((r) => { if (!r.ok) throw new Error('days'); return r.json() })
      .then((d: PlanDays) => { if (live) setData(d) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [planId])

  if (failed) return <p className="a-hint" role="alert">Couldn’t load the days. If you credit now, it counts for today.</p>
  if (!data) return <p className="a-hint" role="status">Loading days…</p>
  if (data.days.length === 0) return null
  const max = Math.floor(amount / data.perSlot + 1e-9)
  if (max < 1) return null

  function toggle(key: string) {
    if (value.includes(key)) onChange(value.filter((k) => k !== key))
    else if (value.length < max) onChange([...value, key])
    else if (max === 1) onChange([key])
  }

  const word = data.weekly ? 'week' : 'day'
  return (
    <fieldset className="lo-fieldset" style={{ margin: '14px 0' }}>
      <legend className="a-label">Which {word} is this for?</legend>
      <p className="a-hint">{max > 1 ? `Choose up to ${max}. ` : ''}If you choose none, it counts for {data.weekly ? 'this week' : 'today'}.</p>
      <div className="lo-chips" style={{ maxHeight: 188, overflowY: 'auto' }}>
        {data.days.map((d) => {
          const on = value.includes(d.key)
          return (
            <button key={d.key} type="button" className="lo-chip" style={{ minHeight: 44, opacity: !on && max > 1 && value.length >= max ? 0.45 : 1 }}
              aria-pressed={on} disabled={!on && max > 1 && value.length >= max} onClick={() => toggle(d.key)}>
              {d.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
