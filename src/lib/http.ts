// Client-side request helper: every failure becomes a typed result with a plain-English message,
// so screens never show raw server text like "Invalid credentials" or hang on a dead connection.

export type HttpFailure = {
  ok: false
  /** HTTP status, or 0 when the request never got a response. */
  status: number
  kind: 'http' | 'network' | 'timeout'
  /** The server's own `error` text, if it sent one. */
  serverMessage: string
}

export type HttpResult<T> = { ok: true; status: number; data: T } | HttpFailure

const DEFAULT_TIMEOUT_MS = 20_000

export async function postJson<T>(url: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpResult<T>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, status: 0, kind: 'network', serverMessage: '' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let data: unknown = null
    try { data = await res.json() } catch { /* empty or non-JSON body (e.g. a proxy error page) */ }
    if (res.ok) return { ok: true, status: res.status, data: data as T }
    const serverMessage =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : ''
    return { ok: false, status: res.status, kind: 'http', serverMessage }
  } catch {
    return { ok: false, status: 0, kind: controller.signal.aborted ? 'timeout' : 'network', serverMessage: '' }
  } finally {
    clearTimeout(timer)
  }
}

export const NETWORK_MESSAGE = 'No internet connection. Check your data or Wi-Fi and try again.'

/**
 * Turns a failure into words a customer understands. `byStatus` lets a screen word specific
 * cases (e.g. 401 on a login form); otherwise the server's message is used for 4xx errors.
 */
export function describeFailure(failure: HttpFailure, byStatus: Partial<Record<number, string>> = {}): string {
  if (failure.kind === 'network') return NETWORK_MESSAGE
  if (failure.kind === 'timeout') return 'This is taking too long. Check your connection and try again.'
  const specific = byStatus[failure.status]
  if (specific) return specific
  if (failure.status === 429) return 'Too many tries. Please wait a few minutes and try again.'
  if (failure.status >= 500) return 'Something went wrong on our side. Please try again in a moment.'
  return failure.serverMessage || 'Something went wrong. Please try again.'
}

/** Nigerian mobile numbers as entered in this app: 11 digits starting with 0. */
export function phoneError(phone: string): string {
  if (!phone) return 'Enter your phone number.'
  if (!/^0\d{10}$/.test(phone)) return 'Phone numbers have 11 digits, like 08012345678.'
  return ''
}
