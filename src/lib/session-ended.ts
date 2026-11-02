// A 401 on its own doesn't mean the session is over: a busy database fails the session check too. These tell
// the two apart, and make sure an agent whose session really has ended can't get stuck on a dead screen.

/** Only a clear answer with no user counts. A failure or an unreadable reply says nothing about the session. */
export async function sessionHasEnded(
  fetchSession: () => Promise<Response> = () => fetch('/api/auth/session'),
): Promise<boolean> {
  try {
    const res = await fetchSession()
    if (!res.ok) return false
    const body = await res.json() as { user?: unknown } | null
    return !body?.user
  } catch {
    return false
  }
}

const SIGN_OUT_TIMEOUT_MS = 8000

/** Sign out, falling back if that fails or hangs. A successful sign-out navigates away, so the timer never fires. */
export async function leaveEndedSession(
  signOutFn: () => Promise<unknown>,
  fallback: () => void,
  timeoutMs = SIGN_OUT_TIMEOUT_MS,
): Promise<void> {
  const timer = setTimeout(fallback, timeoutMs)
  try {
    await signOutFn()
    clearTimeout(timer)
  } catch {
    clearTimeout(timer)
    fallback()
  }
}
