import type React from 'react'

export function blockMinus(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault()
}

export function nonNegativeString(v: string): string {
  // Strip every non-digit and non-dot character. Allow only one decimal point.
  let cleaned = v.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  return cleaned
}

/** Strip every non-digit character — for phone numbers, OTP codes, etc. */
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, '')
}

/** Block keystrokes that would introduce non-digits. Pair with `digitsOnly` in onChange to also defeat paste. */
export function blockNonDigit(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  // allow control keys (Backspace, Tab, arrows, etc.) — they have key.length > 1
  if (e.key.length !== 1) return
  if (!/\d/.test(e.key)) e.preventDefault()
}
