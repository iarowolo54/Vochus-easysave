/**
 * Session-expiry policy: idle timeout + absolute cap. Pure and dependency-free
 * (imports nothing) so middleware, route handlers and tests can all share it.
 *
 * Contract: `evaluateSession` takes `loginAt` as epoch SECONDS and a number
 * only. It does not handle a missing value. MIDDLEWARE callers must substitute
 * the token's `iat` (or `nowSec`) when a legacy token has no `loginAt`, so
 * sessions issued before this deploy roll over gracefully instead of crashing.
 *
 * Version lock: the middleware that applies this decodes/re-encodes the
 * next-auth v4 JWT (key derivation via HKDF in next-auth/jwt). That derivation
 * is specific to next-auth v4; re-check it before upgrading next-auth.
 */

export type Actor = 'admin' | 'agent' | 'customer'

/** Seconds of inactivity before a session lapses. */
export const IDLE_SECONDS: Record<Actor, number> = {
  admin: 900,
  agent: 3600,
  customer: 3600,
}

/** Hard cap (seconds since login) regardless of activity. */
export const ABSOLUTE_SECONDS: Record<Actor, number> = {
  admin: 28800,
  agent: 604800,
  customer: 604800,
}

/**
 * Stricter idle limit inside the mobile apps (agent + customer), enforced on
 * the client: IdleTimeout warns and signs out while the app is open, and the
 * Flutter shells (`kIdleTimeout` in mobile/lib/main.dart and mobile-agent/lib/main.dart) sign out on return
 * from the background after this long. Keep those in step with this value.
 */
export const IN_APP_IDLE_SECONDS = 300

export type SessionDecision = { action: 'slide'; newExp: number } | { action: 'expire' }

/**
 * True once `nowSec` is strictly past `loginAt + ABSOLUTE_SECONDS[actor]`.
 * The single source of the absolute-cap math — used by the proxy AND by the
 * token-consumption trust points (NextAuth session callbacks, customer verify).
 */
export function isPastAbsoluteCap(actor: Actor, loginAt: number, nowSec: number): boolean {
  return nowSec > loginAt + ABSOLUTE_SECONDS[actor]
}

/** Expire only once `nowSec` is strictly past `loginAt + ABSOLUTE_SECONDS`. */
export function evaluateSession(actor: Actor, loginAt: number, nowSec: number): SessionDecision {
  if (isPastAbsoluteCap(actor, loginAt, nowSec)) return { action: 'expire' }
  return { action: 'slide', newExp: nowSec + IDLE_SECONDS[actor] }
}

const CUSTOMER_PUBLIC = new Set(['login', 'enroll', 'forgot-password', 'unlock'])

/** Which actor guards this page, or null for public/unguarded pages. Matches on path segments. */
export function actorForPage(pathname: string): { actor: Actor; loginUrl: string } | null {
  const segs = pathname.split('/').filter(Boolean)
  const [root, second] = segs
  if (root === 'dashboard') return { actor: 'agent', loginUrl: '/login' }
  if (root === 'superadmin') {
    return second === 'login' ? null : { actor: 'admin', loginUrl: '/superadmin/login' }
  }
  if (root === 'customer') {
    return second !== undefined && CUSTOMER_PUBLIC.has(second)
      ? null
      : { actor: 'customer', loginUrl: '/customer/login' }
  }
  return null
}
