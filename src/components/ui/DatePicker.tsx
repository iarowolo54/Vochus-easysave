'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import BottomSheet from './BottomSheet'
import { today, isoDate, parseDateInput } from '@/lib/plan-dates'
import { formatDate } from '@/lib/format'
import { monthView, canGoPrev, canGoNext, stepMonth, initialView, isSelectable, yearOptions, viewForYear, MONTH_NAMES, WEEKDAYS } from '@/lib/calendar'

/**
 * In-page date picker that replaces the native <input type="date"> (poor UX in the app WebViews).
 * Opens the app's BottomSheet with a month grid. `value`/`min`/`max` are ISO yyyy-mm-dd strings and
 * it emits an ISO string, so the same component serves plan-start (min=today), date-of-birth
 * (max=today) and date filters.
 */
export default function DatePicker({
  id, value, onChange, minIso = null, maxIso = null,
  ariaLabel = 'Pick a date', sheetTitle = 'Pick a date', todayPrefix = false,
  allowEmpty = false, placeholder = 'Not set', yearPicker = false, emptyViewIso = null, renderTrigger,
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
  /** For optional dates and filters: an empty value shows `placeholder`, and the sheet gets a Clear button. */
  allowEmpty?: boolean
  placeholder?: string
  /** Month and year drop-downs in the header, for dates far from today such as a date of birth. */
  yearPicker?: boolean
  /** The date the calendar opens on while nothing is chosen (e.g. 30 years ago for a date of birth). */
  emptyViewIso?: string | null
  /** Replace the default field button, e.g. with a filter chip. */
  renderTrigger?: (t: { id?: string; open: () => void; expanded: boolean; text: string; hasValue: boolean }) => ReactNode
}) {
  const t = today()
  const todayIso = isoDate(t)
  const monthId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(value)
  const [view, setView] = useState(() => initialView({ today: t, selectedIso: value || emptyViewIso, minIso, maxIso }))

  // When the sheet opens, move focus to the selected day (native showModal lands on Close otherwise).
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      (gridRef.current?.querySelector('.ui-dp-sel') as HTMLButtonElement | null)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  const selDate = parseDateInput(value) ?? t
  const fieldText = !value && allowEmpty ? placeholder : (todayPrefix && value === todayIso ? 'Today · ' : '') + formatDate(selDate)

  function openSheet() {
    setPending(value)
    setView(initialView({ today: t, selectedIso: value || emptyViewIso, minIso, maxIso }))
    setOpen(true)
  }
  const pendingOk = isSelectable(pending, minIso, maxIso)
  function confirm() { if (!pendingOk) return; onChange(pending); setOpen(false) }
  function clear() { onChange(''); setOpen(false) }
  const years = yearPicker ? yearOptions(t, minIso, maxIso) : []

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
      {renderTrigger ? renderTrigger({ id, open: openSheet, expanded: open, text: fieldText, hasValue: !!value }) : (
      <button type="button" id={id} className="ui-dp-field" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${ariaLabel}: ${fieldText}`} onClick={openSheet}>
        <svg className="ui-dp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
        <span className="ui-dp-val">{fieldText}</span>
        <svg className="ui-dp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <div className="ui-dp-cal">
          <div className="ui-dp-head">
            {yearPicker ? (
              <div className="ui-dp-month ui-dp-selects" id={monthId}>
                <select aria-label="Month" value={view.month} onChange={e => setView(v => ({ ...v, month: Number(e.target.value) }))}>
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select aria-label="Year" value={view.year} onChange={e => setView(v => viewForYear(Number(e.target.value), v.month, minIso, maxIso))}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            ) : <strong className="ui-dp-month" id={monthId} aria-live="polite">{mv.title}</strong>}
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
            {todayInRange && !yearPicker && <button type="button" className="ui-dp-chip" aria-pressed={pending === todayIso}
              onClick={() => { setPending(todayIso); setView({ year: t.getFullYear(), month: t.getMonth() }) }}>Today</button>}
            {allowEmpty && !!value && <button type="button" className="ui-dp-chip" onClick={clear}>Clear</button>}
            <button type="button" className="ui-dp-use" disabled={!pendingOk} onClick={confirm}>Use this date</button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}
