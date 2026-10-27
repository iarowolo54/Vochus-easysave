'use client'

type Props = {
  value: string
  onChange: (digits: string) => void
  onComplete?: () => void
  length?: number
  label: string
  error?: boolean
  errorId?: string
  autoFocus?: boolean
}

/** One-digit-per-box code entry. A single real input sits on top, so paste and SMS autofill still work. */
export default function CodeBoxes({ value, onChange, onComplete, length = 6, label, error, errorId, autoFocus }: Props) {
  return (
    <label className="ag-otp-boxes">
      <span className="ag-sr">{label}</span>
      <input
        className="ag-otp-real"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        value={value}
        aria-invalid={error || undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onKeyDown={e => { if (e.key === 'Enter' && value.length === length) onComplete?.() }}
      />
      {Array.from({ length }, (_, i) => (
        <span key={i} aria-hidden="true" className={`ag-otp-box${value[i] ? ' is-filled' : ''}${i === value.length ? ' is-next' : ''}${error ? ' is-error' : ''}`}>
          {value[i] ?? ''}
        </span>
      ))}
    </label>
  )
}
