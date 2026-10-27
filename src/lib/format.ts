// Client-safe display formatting. For server-side rounding use money() in wallet-guard.ts.

const nairaFmt = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nairaWholeFmt = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** ₦1,250.00 — or ₦1,250 with { minor: false } for rates like "₦500 daily". */
export function formatNaira(n: number, opts: { minor?: boolean } = {}): string {
  const v = finite(n)
  const body = (opts.minor === false ? nairaWholeFmt : nairaFmt).format(Math.abs(v))
  return `${v < 0 ? '-' : ''}₦${body}`
}

/** Splits ₦1,250.00 into { whole: '₦1,250', minor: '.00' } so the kobo can render smaller. */
export function nairaParts(n: number): { whole: string; minor: string } {
  const s = formatNaira(n)
  const dot = s.lastIndexOf('.')
  return { whole: s.slice(0, dot), minor: s.slice(dot) }
}

/** 4 Mar 2026 */
export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "john dose" → "John Dose". Names are stored as typed at enrolment. */
export function displayName(name: string): string {
  return name.trim().split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
}

/** 7:19 am — always with am/pm; the en-NG locale alone drops it. */
export function formatTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}
