// Staff editing a customer's or agent's personal details. Safe to import from client components: the same field list
// drives the form and the server check, and only the fields listed here can ever be written.
import { normalizePhone } from './phone'
import { normalizeEmail } from './email'
import { validateDob, validateGender, validateLga, validateState } from './customer-fields'

export type ProfileFieldKind = 'text' | 'phone' | 'email' | 'dob' | 'gender' | 'state' | 'lga'

export interface ProfileField {
  key: string
  label: string
  kind: ProfileFieldKind
  /** Can't be left empty. Checked only when the field is changed, so older records missing a value still save. */
  required: boolean
  max?: number
  section: 'Person' | 'Contact' | 'Next of kin'
}

export const CUSTOMER_PROFILE_FIELDS: readonly ProfileField[] = [
  { key: 'firstName', label: 'First name', kind: 'text', required: true, max: 60, section: 'Person' },
  { key: 'lastName', label: 'Last name', kind: 'text', required: true, max: 60, section: 'Person' },
  { key: 'gender', label: 'Gender', kind: 'gender', required: true, section: 'Person' },
  { key: 'dob', label: 'Date of birth', kind: 'dob', required: true, section: 'Person' },
  { key: 'phone', label: 'Phone number', kind: 'phone', required: true, section: 'Contact' },
  { key: 'email', label: 'Email', kind: 'email', required: false, max: 120, section: 'Contact' },
  { key: 'address', label: 'Home address', kind: 'text', required: true, max: 200, section: 'Contact' },
  { key: 'state', label: 'State', kind: 'state', required: true, section: 'Contact' },
  { key: 'lga', label: 'Local government', kind: 'lga', required: true, section: 'Contact' },
  { key: 'nokName', label: 'Next of kin name', kind: 'text', required: true, max: 120, section: 'Next of kin' },
  { key: 'nokRelation', label: 'Relationship', kind: 'text', required: true, max: 60, section: 'Next of kin' },
  { key: 'nokPhone', label: 'Next of kin phone', kind: 'phone', required: true, section: 'Next of kin' },
]

export const AGENT_PROFILE_FIELDS: readonly ProfileField[] = [
  { key: 'name', label: 'Full name', kind: 'text', required: true, max: 120, section: 'Person' },
  { key: 'gender', label: 'Gender', kind: 'gender', required: false, section: 'Person' },
  { key: 'dob', label: 'Date of birth', kind: 'dob', required: false, section: 'Person' },
  { key: 'phone', label: 'Phone number', kind: 'phone', required: true, section: 'Contact' },
  { key: 'email', label: 'Email', kind: 'email', required: false, max: 120, section: 'Contact' },
  { key: 'location', label: 'Location', kind: 'text', required: true, max: 120, section: 'Contact' },
  { key: 'address', label: 'Address', kind: 'text', required: false, max: 200, section: 'Contact' },
  { key: 'nokName', label: 'Next of kin name', kind: 'text', required: false, max: 120, section: 'Next of kin' },
  { key: 'nokPhone', label: 'Next of kin phone', kind: 'phone', required: false, section: 'Next of kin' },
]

/**
 * Changes that need the approval PIN: the phone and email decide where sign-in and reset codes go, and the name is what
 * payouts to a bank account are checked against, so renaming someone could lift a held payout.
 */
export const PIN_FIELDS = ['phone', 'email', 'name', 'firstName', 'lastName'] as const
export const NAME_FIELDS = ['name', 'firstName', 'lastName'] as const

/** A stored value as the form shows it: dates as YYYY-MM-DD, everything else as text. */
export function formValue(kind: ProfileFieldKind, v: unknown): string {
  if (v == null) return ''
  if (kind === 'dob') {
    const d = v instanceof Date ? v : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? null : new Date(String(v))
    if (d === null) return String(v).slice(0, 10)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return String(v)
}

/** How a typed value is compared and stored: trimmed, phones in 0-prefixed form, emails lower-case. */
function clean(kind: ProfileFieldKind, raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, kind === 'phone' || kind === 'email' ? '' : ' ') : ''
  if (!s) return ''
  if (kind === 'phone') return normalizePhone(s.replace(/\D/g, '').replace(/^234(?=\d{10}$)/, '0'))
  if (kind === 'email') return normalizeEmail(s)
  return s
}

export interface ProfileChange { key: string; label: string; from: string; to: string }
export type ProfileDiff =
  | { ok: true; data: Record<string, string | Date | null>; changes: ProfileChange[]; needsPin: boolean; nameChanged: boolean }
  | { ok: false; error: string }

/**
 * Compares what staff submitted with what is stored. Only changed fields are checked and returned; a field missing from
 * the submission is left alone. `dobAs` says how this table stores a date of birth.
 */
export function diffProfile(
  fields: readonly ProfileField[],
  current: Record<string, unknown>,
  body: unknown,
  opts: { dobAs: 'date' | 'text'; now?: Date },
): ProfileDiff {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const data: Record<string, string | Date | null> = {}
  const changes: ProfileChange[] = []
  const stateField = fields.find(f => f.kind === 'state')
  const newState = stateField && b[stateField.key] !== undefined ? clean('state', b[stateField.key]) : formValue('state', stateField ? current[stateField.key] : null)
  const stateChanged = !!stateField && newState !== formValue('state', current[stateField.key])

  for (const f of fields) {
    if (b[f.key] === undefined && !(f.kind === 'lga' && stateChanged)) continue
    const before = formValue(f.kind, current[f.key])
    const after = b[f.key] === undefined ? before : clean(f.kind, b[f.key])
    if (after === before && !(f.kind === 'lga' && stateChanged)) continue

    if (!after) {
      if (f.required) return { ok: false, error: `${f.label} can’t be empty.` }
      data[f.key] = null
    } else if (f.max && after.length > f.max) {
      return { ok: false, error: `${f.label} is too long.` }
    } else if (f.kind === 'phone') {
      if (!/^0\d{10}$/.test(after)) return { ok: false, error: `${f.label}: phone numbers have 11 digits.` }
      data[f.key] = after
    } else if (f.kind === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(after)) return { ok: false, error: 'That email address doesn’t look right.' }
      data[f.key] = after
    } else if (f.kind === 'gender') {
      const g = validateGender(after); if (!g.ok) return { ok: false, error: 'Choose Female or Male.' }
      data[f.key] = g.value
    } else if (f.kind === 'state') {
      const s = validateState(after); if (!s.ok) return { ok: false, error: 'Choose a state from the list.' }
      data[f.key] = s.value
    } else if (f.kind === 'lga') {
      const l = validateLga(newState, after); if (!l.ok) return { ok: false, error: 'Choose a local government in the chosen state.' }
      data[f.key] = l.value
    } else if (f.kind === 'dob') {
      const d = validateDob(after, opts.now); if (!d.ok) return { ok: false, error: d.error }
      data[f.key] = opts.dobAs === 'date' ? d.value : after
    } else {
      data[f.key] = after
    }
    if (after !== before) changes.push({ key: f.key, label: f.label, from: before, to: after })
  }

  const has = (keys: readonly string[]) => changes.some(c => keys.includes(c.key))
  return { ok: true, data, changes, needsPin: has(PIN_FIELDS), nameChanged: has(NAME_FIELDS) }
}

/** One audit line: "Phone number 08011112222 → 08033334444; Email (none) → a@b.co". */
export function describeChanges(changes: ProfileChange[]): string {
  return changes.map(c => `${c.label} ${c.from || '(none)'} → ${c.to || '(none)'}`).join('; ')
}
