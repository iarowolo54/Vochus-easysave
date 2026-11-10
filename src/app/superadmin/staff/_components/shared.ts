export async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

export const NO_CONNECTION = 'No connection. Check your internet and try again.'

export interface Department {
  id: string
  name: string
  description: string | null
  status: string
  roleCount: number
  memberCount: number
  lead: { id: string; name: string } | null
}

export interface StaffUser {
  id: string
  name: string
  email: string
  status: string
  lastActiveAt: string | null
  hasApprovalPin: boolean
  isLead: boolean
  department: { id: string; name: string } | null
  role: { id: string; name: string } | null
}

export interface RoleRow {
  id: string
  name: string
  status: string
  permissions: string[]
  staffCount: number
  department: { id: string; name: string }
}

export async function sendJson(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) return { ok: false, error: await errorOf(res, 'That didn’t go through. Try again.') }
    return { ok: true, data: await res.json().catch(() => null) }
  } catch {
    return { ok: false, error: NO_CONNECTION }
  }
}

export type Toast = (m: string, t?: 'success' | 'error') => void
export type InviteLink = { name: string; link: string }

/** Everything the tabs share. Loaded once by the page; a change reloads all three lists. */
export interface StaffData {
  staff: StaffUser[]
  roles: RoleRow[]
  departments: Department[]
}

// A leading = + - @ would run as a formula when the file is opened in a spreadsheet.
const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`

export function downloadCsv(filename: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
