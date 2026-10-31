'use client'
import { useEffect, useId, useRef, useState } from 'react'
import BottomSheet from './BottomSheet'
import { today, isoDate, parseDateInput } from '@/lib/plan-dates'
import { formatDate } from '@/lib/format'
import { monthView, canGoPrev, canGoNext, stepMonth, initialView, isSelectable, WEEKDAYS } from '@/lib/calendar'

/**
 * In-page date picker that replaces the native <input type="date"> (poor UX in the app WebViews).
 * Opens the app's BottomSheet with a month grid. `value`/`min`/`max` are ISO yyyy-mm-dd strings and
 * it emits an ISO string, so the same component serves plan-start (min=today), date-of-birth
 * (max=today) and date filters.
 */
export default function DatePicker({
  id, value, onChange, minIso = null, maxIso = null,
  ariaLabel = 'Pick a date', sheetTitle = 'Pick a date', todayPrefix = false,
}: {
  id?: string
  value: string
  onChange: (iso: string) => void
  minIso?: string | null
  maxIso?: string | null
  ariaLabel?: string
  sheetTitle?: string
  /** Show "Today · …" in the field when the value is today (used by plan start). */
  todayPrefix?: boolean
}) {
  const t = today()
  const todayIso = isoDate(t)
  const monthId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(value)
  const [view, setView] = useState(() => initialView({ today: t, selectedIso: value, minIso, maxIso }))

  // When the sheet opens, move focus to the selected day (native showModal lands on Close otherwise).
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      (gridRef.current?.querySelector('.ui-dp-sel') as HTMLButtonElement | null)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  const selDate = parseDateInput(value) ?? t
  const fieldText = (todayPrefix && value === todayIso ? 'Today · ' : '') + formatDate(selDate)

  function openSheet() {
    setPending(value)
    setView(initialView({ today: t, selectedIso: value, minIso, maxIso }))
    setOpen(true)
  }
  const pendingOk = isSelectable(pending, minIso, maxIso)
  function confirm() { if (!pendingOk) return; onChange(pending); setOpen(false) }

  const mv = monthView(view.year, view.month, { today: t, selectedIso: pending, minIso, maxIso })
  const prevOk = canGoPrev(view.year, view.month, minIso)
  const nextOk = canGoNext(view.year, view.month, maxIso)
  const todayInRange = isSelectable(todayIso, minIso, maxIso)

  const dayLabel = (iso: string, isToday: boolean, disabled: boolean) => {
    const dt = parseDateInput(iso)!
    const base = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return base + (isToday ? ', today' : '') + (disabled ? ', unavailable' : '')
  }

  return (
    <>
      <button type="button" id={id} className="ui-dp-field" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${ariaLabel}: ${fieldText}`} onClick={openSheet}>
        <svg className="ui-dp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
        <span className="ui-dp-val">{fieldText}</span>
        <svg className="ui-dp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <div className="ui-dp-cal">
          <div className="ui-dp-head">
            <strong className="ui-dp-month" id={monthId} aria-live="polite">{mv.title}</strong>
            <div className="ui-dp-nav">
              <button type="button" aria-label="Previous month" disabled={!prevOk}
                onClick={() => prevOk && setView(stepMonth(view.year, view.month, -1))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <button type="button" aria-label="Next month" disabled={!nextOk}
                onClick={() => nextOk && setView(stepMonth(view.year, view.month, 1))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
          <div className="ui-dp-dow" aria-hidden="true">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
          <div className="ui-dp-grid" role="group" aria-labelledby={monthId} ref={gridRef}>
            {Array.from({ length: mv.leadingBlanks }).map((_, i) => <span key={`b${i}`} className="ui-dp-day ui-dp-blank" aria-hidden="true" />)}
            {mv.days.map(d => (
              <button key={d.iso} type="button" disabled={d.disabled}
                aria-current={d.isToday ? 'date' : undefined} aria-pressed={d.isSelected}
                aria-label={dayLabel(d.iso, d.isToday, d.disabled)}
                className={`ui-dp-day${d.isToday ? ' ui-dp-today' : ''}${d.isSelected ? ' ui-dp-sel' : ''}`}
                onClick={() => setPending(d.iso)}>{d.day}</button>
            ))}
          </div>
          <div className="ui-dp-actions">
            {todayInRange && <button type="button" className="ui-dp-chip" aria-pressed={pending === todayIso}
              onClick={() => { setPending(todayIso); setView({ year: t.getFullYear(), month: t.getMonth() }) }}>Today</button>}
            <button type="button" className="ui-dp-use" disabled={!pendingOk} onClick={confirm}>Use this date</button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}
