'use client'

import { blockMinus, nonNegativeString } from '@/lib/numeric'

// Shared by the rate and fee settings pages (Settings → Fees & commission, Settings → Interest rates).

export type Drafts<K extends string | number> = Record<K, string>
export const toDrafts = <K extends string | number>(o: Record<K, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Drafts<K>

/** A valid percentage 0–100, or null. */
export const pct = (s: string) => { const n = parseFloat(s); return s.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null }

export async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

export const nowStr = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function PctInput({ id, value, invalid, onChange, label }: { id: string; value: string; invalid: boolean; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="am-pct">
      <input id={id} className="a-input" type="tel" inputMode="decimal" autoComplete="off" value={value} aria-invalid={invalid} aria-label={label}
        onKeyDown={blockMinus} onChange={e => onChange(nonNegativeString(e.target.value))} />
      <span aria-hidden="true">%</span>
    </div>
  )
}
