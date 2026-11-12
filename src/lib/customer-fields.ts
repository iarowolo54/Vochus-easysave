// Customer demographic fields (#18): gender, state, LGA and date of birth, all REQUIRED on new
// customers. The screens require them and the server is now the guard too. State
// and LGA are validated against the shared NG list, and the LGA must belong to
// the chosen state.
import { NG_STATES, lgasOf } from './ng-lgas'

// Kept for callers/tests that reference the state list by this name.
export const NIGERIA_STATES = NG_STATES

export type Gender = 'Female' | 'Male'

export function validateGender(input: unknown): { ok: true; value: Gender } | { ok: false; error: string } {
  if (input === 'Female' || input === 'Male') return { ok: true, value: input }
  return { ok: false, error: 'Gender is required and must be Female or Male' }
}

// Required: must be one of the 36 states or FCT.
export function validateState(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input === 'string' && (NG_STATES as readonly string[]).includes(input)) return { ok: true, value: input }
  return { ok: false, error: 'State is required and must be one of the 36 states or FCT' }
}

// Required: must be a local government that belongs to the given (already
// validated) state.
export function validateLga(state: string, input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input === 'string' && lgasOf(state).includes(input)) return { ok: true, value: input }
  return { ok: false, error: 'Local government is required and must belong to the chosen state' }
}

// Date of birth: REQUIRED on new customers (owner, Nov 2026), so every account
// carries an age. Takes the screens' YYYY-MM-DD value; rejects dates that don't
// exist (31 Feb), dates after today, and anything over 120 years ago.
export const MAX_AGE_YEARS = 120

export function validateDob(input: unknown, now: Date = new Date()): { ok: true; value: Date } | { ok: false; error: string } {
  const m = typeof input === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim()) : null
  if (!m) return { ok: false, error: 'Enter the date of birth.' }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dob = new Date(y, mo - 1, d)
  if (dob.getFullYear() !== y || dob.getMonth() !== mo - 1 || dob.getDate() !== d) return { ok: false, error: 'The date of birth is not a real date.' }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (dob > today) return { ok: false, error: 'The date of birth can’t be in the future.' }
  if (ageOn(dob, now) > MAX_AGE_YEARS) return { ok: false, error: 'Check the date of birth. That is more than 120 years ago.' }
  return { ok: true, value: dob }
}

/** Whole years old on `now`. */
export function ageOn(dob: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear()
  if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--
  return age
}
