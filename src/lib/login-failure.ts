// What the agent login screen says after a failed sign-in, from what /api/auth/check-agent reports.

export type AgentCheck = {
  locked?: boolean; deviceMismatch?: boolean
  unverifiedEmail?: boolean; exists?: boolean; status?: string; throttledSeconds?: number
}

export type LoginFailure = { message: string; field?: 'identifier' | 'password' }

export const FINGERPRINT_FAILED = 'Fingerprint sign-in didn’t work. Please sign in with your password.'

export type AuthReachability = 'ok' | 'offline' | 'server'

/**
 * next-auth's signIn sends the browser to its bare error page when it can't load the provider list, even with
 * redirect: false. Asking first keeps the agent on the login form, and tells no connection apart from a fault of ours.
 */
export async function authReachability(fetchProviders: () => Promise<Response> = () => fetch('/api/auth/providers')): Promise<AuthReachability> {
  try {
    return (await fetchProviders()).ok ? 'ok' : 'server'
  } catch {
    return 'offline'
  }
}

export function reachabilityMessage(state: Exclude<AuthReachability, 'ok'>): string {
  return state === 'offline'
    ? 'No internet connection. Check your data or Wi-Fi and try again.'
    : 'Something went wrong on our side. Please try again in a moment.'
}

export function loginFailure(c: AgentCheck, via: 'password' | 'fingerprint'): LoginFailure {
  if (c.throttledSeconds) return { message: `Too many sign-in attempts from this network. Try again in ${Math.ceil(c.throttledSeconds / 60)} min.` }
  if (c.locked && via === 'fingerprint') return { message: 'Your account is locked. Tap “Forgot password?” to unlock it with a code.' }
  if (c.locked) return { message: 'Your account is locked after too many wrong passwords. Tap “Forgot password?” to unlock it with a code.' }
  if (c.deviceMismatch) return { message: 'This account is linked to another phone. Ask your administrator to reset it.' }
  if (c.unverifiedEmail) return { message: 'Your email isn’t verified yet. Check your inbox (and spam) for the link, or contact your administrator.' }
  if (c.exists && c.status === 'Suspended') return { message: 'Your account has been suspended. Please contact your administrator.' }
  if (c.exists && c.status !== 'Active') return { message: 'Your account is waiting to be activated. Please contact your administrator.' }
  if (via === 'fingerprint') return { message: FINGERPRINT_FAILED }
  if (c.exists) return { message: 'Wrong password. Try again, or tap “Forgot password?” to reset it.', field: 'password' }
  return { message: 'No account found with that agent ID or phone number. Check it, or contact your administrator.', field: 'identifier' }
}
