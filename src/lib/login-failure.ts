// What the agent login screen says after a failed sign-in, from what /api/auth/check-agent reports.

export type AgentCheck = {
  locked?: boolean; lockedMinutesRemaining?: number; deviceMismatch?: boolean
  unverifiedEmail?: boolean; exists?: boolean; status?: string; throttledSeconds?: number
}

export type LoginFailure = { message: string; field?: 'identifier' | 'password' }

export const FINGERPRINT_FAILED = 'Fingerprint sign-in didn’t work. Please sign in with your password.'

/**
 * next-auth's signIn sends the browser to its bare error page when it can't load the provider list, even with
 * redirect: false. Asking first keeps an agent with no connection on the login form.
 */
export async function canReachAuth(fetchProviders: () => Promise<Response> = () => fetch('/api/auth/providers')): Promise<boolean> {
  try {
    return (await fetchProviders()).ok
  } catch {
    return false
  }
}

export function loginFailure(c: AgentCheck, via: 'password' | 'fingerprint'): LoginFailure {
  if (c.throttledSeconds) return { message: `Too many sign-in attempts from this network. Try again in ${Math.ceil(c.throttledSeconds / 60)} min.` }
  if (c.locked && via === 'fingerprint') return { message: `Your account is locked. Try again in ${c.lockedMinutesRemaining} min, or tap “Forgot password?” to reset it now.` }
  if (c.locked) return { message: `Your account is locked after too many wrong passwords. Try again in ${c.lockedMinutesRemaining} min, or tap “Forgot password?” to reset it now.` }
  if (c.deviceMismatch) return { message: 'This account is linked to another phone. Ask your administrator to reset it.' }
  if (c.unverifiedEmail) return { message: 'Your email isn’t verified yet. Check your inbox (and spam) for the link, or contact your administrator.' }
  if (c.exists && c.status === 'Suspended') return { message: 'Your account has been suspended. Please contact your administrator.' }
  if (c.exists && c.status !== 'Active') return { message: 'Your account is waiting to be activated. Please contact your administrator.' }
  if (via === 'fingerprint') return { message: FINGERPRINT_FAILED }
  if (c.exists) return { message: 'Wrong password. Try again, or tap “Forgot password?” to reset it.', field: 'password' }
  return { message: 'No account found with that agent ID or phone number. Check it, or contact your administrator.', field: 'identifier' }
}
