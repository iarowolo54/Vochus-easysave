// Customer demographic fields (#18): gender (required, Female/Male), state (one
// of the 36 states + FCT, optional), lga (optional, no official list yet).

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
  'Sokoto', 'Taraba', 'Yobe', 'Zamfara', 'FCT',
] as const

export type Gender = 'Female' | 'Male'

export function validateGender(input: unknown): { ok: true; value: Gender } | { ok: false; error: string } {
  if (input === 'Female' || input === 'Male') return { ok: true, value: input }
  return { ok: false, error: 'Gender is required and must be Female or Male' }
}

// Optional. Missing/empty -> null. Provided must be a real state.
export function validateState(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null || input === '') return { ok: true, value: null }
  if (typeof input === 'string' && (NIGERIA_STATES as readonly string[]).includes(input)) return { ok: true, value: input }
  return { ok: false, error: 'State must be one of the 36 states or FCT' }
}

// Optional free text for now (no official LGA list yet).
export function normalizeLga(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null
}
