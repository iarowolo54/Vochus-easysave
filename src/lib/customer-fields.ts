// Customer demographic fields (#18): gender, state and LGA, all REQUIRED on new
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
