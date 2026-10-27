'use client'
import { useEffect, useRef } from 'react'
import { Icons } from './icons'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  /** PINs are 4–6 digits, so the pad can't know when one is complete: the agent taps the tick. */
  min?: number
  max?: number
  busy?: boolean
  error?: string
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'] as const

/** Large on-screen keypad for a transaction PIN — quick to use one-handed, no keyboard covering the sheet. */
export default function PinPad({ value, onChange, onSubmit, min = 4, max = 6, busy, error }: Props) {
  const dotsRef = useRef<HTMLDivElement>(null)

  // Shake the dots on a wrong PIN.
  useEffect(() => {
    if (!error || !dotsRef.current) return
    const el = dotsRef.current
    el.classList.remove('is-shaking')
    void el.offsetWidth
    el.classList.add('is-shaking')
  }, [error])

  // A physical keyboard still works (desktop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return
      if (/^\d$/.test(e.key) && value.length < max) onChange(value + e.key)
      else if (e.key === 'Backspace') onChange(value.slice(0, -1))
      else if (e.key === 'Enter' && value.length >= min) onSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [value, onChange, onSubmit, min, max, busy])

  return (
    <div className="ui-pinpad">
      <div ref={dotsRef} className="ui-pin-dots" role="status" aria-label={`${value.length} of ${max} digits entered`}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`ui-pin-dot${i < value.length ? ' is-filled' : ''}${i >= min ? ' is-optional' : ''}`} />
        ))}
      </div>
      <p className={`ui-pin-msg${error ? ' is-error' : ''}`} aria-live="assertive">
        {error ? <><Icons.error size={16} aria-hidden="true" /> {error}</> : busy ? 'Checking…' : `${min}–${max} digits`}
      </p>
      <div className="ui-pin-keys">
        {KEYS.map(k => {
          if (k === 'del') {
            return (
              <button key={k} type="button" className="ui-pin-key ui-pin-key--muted" aria-label="Delete" disabled={busy || !value}
                onClick={() => onChange(value.slice(0, -1))}>
                <Icons.back size={24} aria-hidden="true" />
              </button>
            )
          }
          if (k === 'ok') {
            return (
              <button key={k} type="button" className="ui-pin-key ui-pin-key--ok" aria-label="Confirm PIN" disabled={busy || value.length < min}
                onClick={onSubmit}>
                {busy ? <span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> : <Icons.check size={26} aria-hidden="true" />}
              </button>
            )
          }
          return (
            <button key={k} type="button" className="ui-pin-key" disabled={busy || value.length >= max}
              onClick={() => onChange(value + k)}>
              {k}
            </button>
          )
        })}
      </div>
    </div>
  )
}
