'use client'
import { useId } from 'react'
import { FieldError } from './FormErrors'
import { formatDate } from '@/lib/format'
import { MAX_PLAN_DAYS, UNIT_DAYS, addDays, daysBetween, isoDate, lengthLabel, parseDateInput, snapDays, type Cadence } from '@/lib/plan-dates'

type Props = {
  /** The day the plan starts (today unless a start date was chosen). */
  start: Date
  cadence: Cadence
  /** The picked date as "yyyy-mm-dd", or "" before one is picked. */
  value: string
  /** Gives the picked date and the plan length in days it works out to (null while it isn't usable). */
  onChange: (value: string, days: number | null) => void
  label?: string
}

/** Works out a plan's length from the date it should end. Weekly and monthly plans round to whole weeks or months. */
export function endDateDays(value: string, start: Date, cadence: Cadence): number | null {
  const end = parseDateInput(value)
  if (!end) return null
  const days = daysBetween(start, end)
  if (days < UNIT_DAYS[cadence] || days > MAX_PLAN_DAYS) return null
  return snapDays(days, cadence)
}

/** "Ends on" date picker for a savings plan, with a line saying exactly when the plan ends and how long it runs. */
export default function EndDateField({ start, cadence, value, onChange, label = 'Ends on' }: Props) {
  const id = useId()
  const min = addDays(start, UNIT_DAYS[cadence])
  const max = addDays(start, MAX_PLAN_DAYS)
  const picked = parseDateInput(value)
  const days = endDateDays(value, start, cadence)
  const actualEnd = days !== null ? addDays(start, days) : null
  const moved = !!(picked && actualEnd && daysBetween(picked, actualEnd) !== 0)

  const error = !value || !picked ? ''
    : daysBetween(start, picked) < UNIT_DAYS[cadence] ? `Pick a date from ${formatDate(min)}`
    : days === null ? `Pick a date before ${formatDate(addDays(max, 1))}`
    : ''

  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}</label>
        <input id={id} className="ag-tf-input" type="date" value={value} min={isoDate(min)} max={isoDate(max)}
          aria-invalid={error ? true : undefined} aria-describedby={`${id}-note`}
          onChange={e => onChange(e.target.value, endDateDays(e.target.value, start, cadence))}
          // Once they leave the field, show the day the plan really ends (weekly / monthly round to whole units).
          onBlur={() => { if (moved && actualEnd && days !== null) onChange(isoDate(actualEnd), days) }} />
      </div>
      {error
        ? <FieldError id={`${id}-note`} message={error} />
        : <p className="ag-fineprint" id={`${id}-note`}>
            {actualEnd && days !== null
              ? <>{moved ? `${cadence === 'weekly' ? 'Weekly' : 'Monthly'} plans run in whole ${cadence === 'weekly' ? 'weeks' : 'months'}, so it ends on ` : 'Ends on '}<strong>{formatDate(actualEnd)}</strong>, {lengthLabel(days, cadence)} from {formatDate(start)}.</>
              : `Any date from ${formatDate(min)}.`}
          </p>}
    </div>
  )
}
