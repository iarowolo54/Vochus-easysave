'use client'
import { groupDigits } from '@/lib/format'

type Props = {
  /** Plain digits, e.g. "25000" or "25000.5". */
  value: string
  onChange: (plain: string) => void
  label?: string
  hint?: string
  invalid?: boolean
  disabled?: boolean
}

/** The large centred "₦ 25,000" entry used for money the agent types in. Shows thousands separators as you type. */
export default function AmountField({ value, onChange, label = 'Amount in naira', hint, invalid, disabled }: Props) {
  const shown = groupDigits(value)
  return (
    <>
      <label className={`ag-amount-field${disabled ? ' is-disabled' : ''}`}>
        <span className="ag-amount-currency" aria-hidden="true">₦</span>
        <input
          className="ag-amount-input"
          type="tel"
          inputMode="decimal"
          placeholder="0"
          aria-label={label}
          aria-invalid={invalid || undefined}
          // Grows with the number so ₦ and the amount stay centred together.
          style={{ width: `${Math.max(1, shown.length) + 0.5}ch` }}
          value={shown}
          disabled={disabled}
          onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
          onChange={e => {
            const plain = e.target.value.replace(/[^0-9.]/g, '')
            const [whole, ...rest] = plain.split('.')
            onChange(rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole)
          }}
        />
      </label>
      {hint && <p className={`ag-amount-hint${invalid ? ' is-error' : ''}`}>{hint}</p>}
    </>
  )
}
