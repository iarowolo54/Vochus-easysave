'use client'
import { useMemo, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { buildSlots, dateKey, hasEnded, isWeekly, type Slot, type SlotState } from '@/lib/savings-card'

type Plan = { startDate: string; maturityDate: string; periodDays: number; cadence?: string; balance: number; dailyAmount: number }

type Props = {
  plan: Plan
  depositDates: string[]
  hideAmounts: boolean
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const STATE_TEXT: Record<SlotState | 'off', string> = {
  saved: 'saved', missed: 'missed', today: 'not saved yet', upcoming: 'coming up', off: 'not in this plan',
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`
}

/** The digital version of the paper contribution card: one circle per day (or week). */
export default function SavingsCard({ plan, depositDates, hideAmounts }: Props) {
  const weekly = isWeekly(plan)
  const ended = hasEnded(plan)
  const slots = useMemo(() => buildSlots(plan, depositDates), [plan, depositDates])
  const saved = slots.filter(s => s.state === 'saved').length
  const missed = slots.filter(s => s.state === 'missed').length
  const unit = weekly ? 'week' : 'day'
  const target = plan.dailyAmount * plan.periodDays
  const pct = target > 0 ? Math.min(100, Math.round((plan.balance / target) * 100)) : 0

  return (
    <section className="ui-card" aria-label="Savings card">
      <div className="ui-card-head">
        <h2 className="ui-card-title">Savings card</h2>
        <span className="ui-card-meta">{saved} of {slots.length} {unit}s saved</span>
      </div>

      {ended ? (
        <p className="ui-card-status ui-card-status--neutral">
          Plan finished. You saved on {saved} of {slots.length} {unit}s.
        </p>
      ) : (
        <p className={`ui-card-status${missed ? ' ui-card-status--warn' : ''}`}>
          {missed
            ? <><Icons.error size={16} aria-hidden="true" /> You’ve missed {missed} {unit}{missed > 1 ? 's' : ''}</>
            : <><Icons.check size={16} aria-hidden="true" /> You’re on track</>}
        </p>
      )}

      {weekly ? <WeekGrid slots={slots} /> : <MonthCalendar slots={slots} />}

      <ul className="ui-legend" aria-label="Key">
        <li><span className="ui-cal-day ui-cal-day--saved" aria-hidden="true" /> Saved</li>
        <li><span className="ui-cal-day ui-cal-day--missed" aria-hidden="true" /> Missed</li>
        <li><span className="ui-cal-day ui-cal-day--today" aria-hidden="true" /> {weekly ? 'This week' : 'Today'}</li>
        <li><span className="ui-cal-day ui-cal-day--upcoming" aria-hidden="true" /> To come</li>
      </ul>

      <div className="ui-progress-foot ui-progress-foot--top">
        <span>{hideAmounts ? 'Saved ₦ ••••' : `${formatNaira(plan.balance)} saved`}</span>
        <span>Goal {formatNaira(target)}</span>
      </div>
      <div className="ui-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to goal">
        <span style={{ width: `${pct}%` }} />
      </div>
    </section>
  )
}

function MonthCalendar({ slots }: { slots: Slot[] }) {
  const byKey = useMemo(() => new Map(slots.map(s => [s.key, s])), [slots])
  const months = useMemo(() => {
    const seen: Date[] = []
    for (const s of slots) {
      if (!seen.length || monthKey(seen[seen.length - 1]) !== monthKey(s.date)) seen.push(new Date(s.date.getFullYear(), s.date.getMonth(), 1))
    }
    return seen
  }, [slots])

  const [idx, setIdx] = useState(() => {
    const now = new Date()
    const i = months.findIndex(m => monthKey(m) === monthKey(now))
    if (i >= 0) return i
    return slots.length && dateKey(now) < slots[0].key ? 0 : months.length - 1
  })
  const month = months[idx]
  if (!month) return null

  const offset = (month.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const label = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="ui-cal">
      <div className="ui-cal-head">
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setIdx(i => i - 1)} disabled={idx === 0} aria-label="Previous month">
          <Icons.back size={18} aria-hidden="true" />
        </button>
        <span className="ui-cal-title" aria-live="polite">{label}</span>
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setIdx(i => i + 1)} disabled={idx === months.length - 1} aria-label="Next month">
          <Icons.next size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="ui-cal-grid" aria-hidden="true">
        {WEEKDAYS.map((d, i) => <span key={i} className="ui-cal-dow">{d}</span>)}
      </div>
      <ol className="ui-cal-grid">
        {Array.from({ length: offset }, (_, i) => <li key={`pad-${i}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(month.getFullYear(), month.getMonth(), i + 1)
          const slot = byKey.get(dateKey(date))
          const state = slot?.state ?? 'off'
          return (
            <li key={i} className={`ui-cal-day ui-cal-day--${state}`} aria-label={`${formatDate(date)}: ${STATE_TEXT[state]}`}>
              {i + 1}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function WeekGrid({ slots }: { slots: Slot[] }) {
  return (
    <ol className="ui-cal-grid ui-cal-grid--weeks">
      {slots.map(s => (
        <li key={s.key} className={`ui-cal-day ui-cal-day--${s.state}`} aria-label={`Week ${s.index}, from ${formatDate(s.date)}: ${STATE_TEXT[s.state]}`}>
          {s.index}
        </li>
      ))}
    </ol>
  )
}
