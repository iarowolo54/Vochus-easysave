'use client'
import { useMemo, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import { depositIcon, depositMethod } from './DepositReceipt'
import {
  buildSlots, currentWeekDays, dateKey, depositsByDay, hasEnded, isWeekly, slotEndKey,
  type Slot, type SlotState,
} from '@/lib/savings-card'

type Plan = { startDate: string; maturityDate: string; periodDays: number; cadence?: string; balance: number; dailyAmount: number }

export type Deposit = { id: string; amount: number; createdAt: string; method: string | null; recordedBy: string }

/** What the day-details sheet shows for a tapped day (or week). */
export type DaySelection = { title: string; state: SlotState; deposits: Deposit[]; ended: boolean }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATE_TEXT: Record<SlotState, string> = {
  saved: 'saved', missed: 'missed', today: 'not saved yet', upcoming: 'coming up',
}

function shortDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function useCardData(plan: Plan, deposits: Deposit[]) {
  const weekly = isWeekly(plan)
  const ended = hasEnded(plan)
  const slots = useMemo(() => buildSlots(plan, deposits.map(d => d.createdAt)), [plan, deposits])
  const byDay = useMemo(() => depositsByDay(deposits), [deposits])

  function select(slot: Slot): DaySelection {
    const end = slotEndKey(slot, weekly)
    const list = weekly
      ? [...byDay.entries()].filter(([k]) => k >= slot.key && k <= end).flatMap(([, v]) => v)
      : byDay.get(slot.key) ?? []
    const endDate = new Date(slot.date.getFullYear(), slot.date.getMonth(), slot.date.getDate() + 6)
    const title = weekly
      ? `Week ${slot.index} · ${shortDate(slot.date)} – ${shortDate(endDate)}`
      : slot.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    return { title, state: slot.state, deposits: list, ended }
  }

  return { weekly, ended, slots, select }
}

function slotLabel(slot: Slot, weekly: boolean, ended: boolean) {
  const what = ended && slot.state === 'missed' ? 'not saved' : STATE_TEXT[slot.state]
  return weekly ? `Week ${slot.index}, from ${formatDate(slot.date)}: ${what}` : `${formatDate(slot.date)}: ${what}`
}

function stateClass(state: SlotState, ended: boolean) {
  return `ui-cal-day ui-cal-day--${ended && state === 'missed' ? 'unsaved' : state}`
}

/* ── Home screen: this week at a glance ─────────────────────────────── */

type StripProps = {
  plan: Plan
  deposits: Deposit[]
  onOpenCard: () => void
  onSelect: (s: DaySelection) => void
}

export function WeekStrip({ plan, deposits, onOpenCard, onSelect }: StripProps) {
  const { weekly, ended, slots, select } = useCardData(plan, deposits)
  const today = dateKey(new Date())

  let cells: { label: string; slot?: Slot; isToday: boolean; dayNum: number }[]
  let summary: string
  if (!weekly) {
    const byKey = new Map(slots.map(s => [s.key, s]))
    cells = currentWeekDays().map((d, i) => {
      const k = dateKey(d)
      return { label: WEEKDAYS[i], slot: byKey.get(k), isToday: k === today, dayNum: d.getDate() }
    })
    // Today only counts once it's saved, so the morning doesn't read as a missed day.
    const counted = cells.filter(c => c.slot && (c.slot.key < today || (c.slot.key === today && c.slot.state === 'saved')))
    const saved = counted.filter(c => c.slot!.state === 'saved').length
    summary = counted.length
      ? `${saved} of ${counted.length} day${counted.length > 1 ? 's' : ''} saved this week`
      : slots.length && slots[0].key > today ? `Your plan starts ${formatDate(slots[0].date)}` : 'Save today to start your week'
  } else {
    // The current week is found by date, not state: a week already saved this week is still "now".
    const isNow = (s: Slot) => s.key <= today && today <= slotEndKey(s, true)
    let cur = slots.findIndex(isNow)
    if (cur < 0) cur = slots.length && today < slots[0].key ? 0 : slots.length - 1
    const startIdx = Math.max(0, Math.min(cur - 3, slots.length - 7))
    cells = slots.slice(startIdx, startIdx + 7).map(s => ({ label: `Wk ${s.index}`, slot: s, isToday: isNow(s), dayNum: s.index }))
    const elapsed = slots.filter(s => s.key <= today)
    summary = `${elapsed.filter(s => s.state === 'saved').length} of ${elapsed.length} weeks saved`
  }

  return (
    <section className="ui-card" aria-label={weekly ? 'Your weeks' : 'This week'}>
      <div className="ui-card-head">
        <h2 className="ui-card-title">{weekly ? 'Your weeks' : 'This week'}</h2>
        <span className="ui-card-meta">{summary}</span>
      </div>
      <ol className="ui-week">
        {cells.map((c, i) => (
          <li key={i} className={`ui-week-day${c.isToday ? ' is-today' : ''}`}>
            <span className="ui-week-label" aria-hidden="true">{c.isToday ? (weekly ? 'Now' : 'Today') : c.label}</span>
            {c.slot ? (
              <button
                type="button"
                className={stateClass(c.slot.state, ended)}
                onClick={() => onSelect(select(c.slot!))}
                aria-label={slotLabel(c.slot, weekly, ended)}
              >
                {c.slot.state === 'saved' ? <Icons.check size={18} aria-hidden="true" /> : c.dayNum}
              </button>
            ) : (
              <span className="ui-cal-day ui-cal-day--off" aria-label={`${c.label}: not in this plan`}>{c.dayNum}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="ui-week-foot">
        <span className="ui-week-hint">Tap a {weekly ? 'week' : 'day'} for details</span>
        <button type="button" className="ui-link ui-week-more" onClick={onOpenCard}>
          See full card <Icons.next size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

/* ── Full savings card (shown in a sheet) ───────────────────────────── */

type CalendarProps = {
  plan: Plan
  deposits: Deposit[]
  hideAmounts: boolean
  onSelect: (s: DaySelection) => void
}

export function SavingsCalendar({ plan, deposits, hideAmounts, onSelect }: CalendarProps) {
  const { weekly, ended, slots, select } = useCardData(plan, deposits)
  const count = (st: SlotState) => slots.filter(s => s.state === st).length
  const saved = count('saved')
  const missed = count('missed')
  const toCome = count('upcoming') + count('today')
  const unit = weekly ? 'week' : 'day'
  const target = plan.dailyAmount * plan.periodDays
  const pct = target > 0 ? Math.min(100, Math.round((plan.balance / target) * 100)) : 0

  return (
    <div className="ui-savings-card">
      {/* The counts double as the key, so nobody has to decode colours first. */}
      <ul className="ui-key" aria-label="Summary">
        <li><span className="ui-cal-day ui-cal-day--saved" aria-hidden="true" /><strong>{saved}</strong> saved</li>
        {ended ? (
          <li><span className="ui-cal-day ui-cal-day--unsaved" aria-hidden="true" /><strong>{missed}</strong> not saved</li>
        ) : (
          <>
            <li><span className="ui-cal-day ui-cal-day--missed" aria-hidden="true" /><strong>{missed}</strong> missed</li>
            <li><span className="ui-cal-day ui-cal-day--upcoming" aria-hidden="true" /><strong>{toCome}</strong> to come</li>
          </>
        )}
      </ul>

      <p className={`ui-card-status${ended ? ' ui-card-status--neutral' : missed ? ' ui-card-status--warn' : ''}`}>
        {ended
          ? <>Plan finished. You saved on {saved} of {slots.length} {unit}s.</>
          : missed
            ? <><Icons.error size={16} aria-hidden="true" /> You’ve missed {missed} {unit}{missed > 1 ? 's' : ''}. Tap a {unit} to see what happened.</>
            : <><Icons.check size={16} aria-hidden="true" /> You’re on track. Tap a {unit} to see what you saved.</>}
      </p>

      {weekly
        ? <WeekGrid slots={slots} ended={ended} onPick={s => onSelect(select(s))} />
        : <MonthCalendar slots={slots} ended={ended} plan={plan} onPick={s => onSelect(select(s))} />}

      {!ended && (
        <>
          <div className="ui-progress-foot ui-progress-foot--top">
            <span>{hideAmounts ? 'Saved ₦ ••••' : `${formatNaira(plan.balance)} saved`}</span>
            <span>Goal {formatNaira(target)}</span>
          </div>
          <div className="ui-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to goal">
            <span style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`
}

function MonthCalendar({ slots, ended, plan, onPick }: { slots: Slot[]; ended: boolean; plan: Plan; onPick: (s: Slot) => void }) {
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
        <div className="ui-cal-heading" aria-live="polite">
          <span className="ui-cal-title">{label}</span>
          <span className="ui-cal-sub">
            {months.length > 1 && `Month ${idx + 1} of ${months.length} · `}
            {shortDate(new Date(plan.startDate))} – {shortDate(new Date(plan.maturityDate))}
          </span>
        </div>
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setIdx(i => i + 1)} disabled={idx === months.length - 1} aria-label="Next month">
          <Icons.next size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="ui-cal-grid" aria-hidden="true">
        {WEEKDAYS.map(d => <span key={d} className="ui-cal-dow">{d}</span>)}
      </div>
      <ol className="ui-cal-grid">
        {Array.from({ length: offset }, (_, i) => <li key={`pad-${i}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(month.getFullYear(), month.getMonth(), i + 1)
          const slot = byKey.get(dateKey(date))
          return (
            <li key={i}>
              {slot ? (
                <button type="button" className={stateClass(slot.state, ended)} onClick={() => onPick(slot)} aria-label={slotLabel(slot, false, ended)}>
                  {i + 1}
                  {slot.state === 'saved' && <span className="ui-cal-check" aria-hidden="true"><Icons.check size={10} strokeWidth={3} /></span>}
                </button>
              ) : (
                <span className="ui-cal-day ui-cal-day--off" aria-label={`${formatDate(date)}: not in this plan`}>{i + 1}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function WeekGrid({ slots, ended, onPick }: { slots: Slot[]; ended: boolean; onPick: (s: Slot) => void }) {
  return (
    <ol className="ui-cal-grid ui-cal-grid--weeks">
      {slots.map(s => (
        <li key={s.key}>
          <button type="button" className={stateClass(s.state, ended)} onClick={() => onPick(s)} aria-label={slotLabel(s, true, ended)}>
            {s.index}
            {s.state === 'saved' && <span className="ui-cal-check" aria-hidden="true"><Icons.check size={10} strokeWidth={3} /></span>}
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ── What happened on a tapped day ──────────────────────────────────── */

export function DayDetails({ selection, hideAmounts, onOpen }: { selection: DaySelection; hideAmounts: boolean; onOpen: (d: Deposit) => void }) {
  const { deposits, state, ended } = selection
  if (deposits.length === 0) {
    const text = state === 'upcoming'
      ? 'This day hasn’t come yet.'
      : state === 'today'
        ? 'Nothing saved yet. If you’ve given your agent money, it will show here once they record it.'
        : ended
          ? 'Nothing was saved on this day.'
          : 'Nothing was saved on this day. If you paid your agent, ask them to record it for this date.'
    return <p className="ui-day-empty">{text}</p>
  }
  const total = deposits.reduce((s, d) => s + d.amount, 0)
  return (
    <div className="ui-card--list">
      {deposits.map(d => (
        <button key={d.id} type="button" className="ui-row ui-row--button" onClick={() => onOpen(d)}>
          <span className="ui-row-icon" aria-hidden="true">{(() => { const I = Icons[depositIcon(d)]; return <I size={20} /> })()}</span>
          <span className="ui-row-main">
            <span className="ui-row-title ui-block">{hideAmounts ? '₦ •••• saved' : `${formatNaira(d.amount)} saved`}</span>
            <span className="ui-row-sub ui-block">{formatTime(d.createdAt)} · {depositMethod(d)}</span>
          </span>
          <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
        </button>
      ))}
      {deposits.length > 1 && !hideAmounts && (
        <div className="ui-row"><div className="ui-row-main ui-row-title">Total</div><div className="ui-row-value">{formatNaira(total)}</div></div>
      )}
    </div>
  )
}
