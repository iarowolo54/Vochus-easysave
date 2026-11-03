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

export async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return { ok: false, error: await errorOf(res, 'That didn’t go through. Try again.') }
    return { ok: true, data: await res.json().catch(() => null) }
  } catch {
    return { ok: false, error: NO_CONNECTION }
  }
}
