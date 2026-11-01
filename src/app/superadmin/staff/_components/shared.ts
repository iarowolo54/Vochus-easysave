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
}

export interface RoleRow {
  id: string
  name: string
  status: string
  permissions: string[]
  staffCount: number
  department: { id: string; name: string }
}

export async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return { ok: false, error: await errorOf(res, 'That didn’t go through. Try again.') }
    return { ok: true }
  } catch {
    return { ok: false, error: NO_CONNECTION }
  }
}
