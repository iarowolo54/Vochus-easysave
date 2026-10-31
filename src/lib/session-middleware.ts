/**
 * Pure decision core for the session-expiry proxy (Next 16 `src/proxy.ts`).
 *
 * This file has NO framework / crypto / Prisma imports so it can be unit-tested
 * without real tokens: decoding is INJECTED as `decoders`. `proxy.ts` wires in
 * the real decoders (`next-auth/jwt` `decode` for agent/admin, `jose`
 * `verifyCustomerToken` for customer); tests pass trivial fakes.
 *
 * Contract: for every session cookie PRESENT on a matched request, decide
 * whether to slide (re-issue with a fresh idle `exp`) or clear it, and — for a
 * guarded PAGE whose actor has no valid (slid) cookie — which login URL to
 * redirect to. API requests are never redirected (the route's own auth check
 * returns 401 once the cookie is gone).
 */

import { evaluateSession, actorForPage, type Actor } from './session-policy'

export const AGENT_COOKIE = 'next-auth.session-token'
export const ADMIN_COOKIE = 'next-admin-auth.session-token'
export const CUSTOMER_COOKIE = 'customer_token'

/** Cookie → actor, in a fixed order so output is deterministic. */
export const COOKIE_ACTORS: ReadonlyArray<{ cookieName: string; actor: Actor }> = [
  { cookieName: AGENT_COOKIE, actor: 'agent' },
  { cookieName: ADMIN_COOKIE, actor: 'admin' },
  { cookieName: CUSTOMER_COOKIE, actor: 'customer' },
]

/** What a decoder yields: the stable `loginAt`, the token `iat`, and all claims. */
export interface DecodedToken {
  loginAt?: number
  iat?: number
  claims: Record<string, unknown>
}

/** Decoding is injected. May be sync (tests) or async (real crypto). */
export type Decoder = (raw: string) => Promise<DecodedToken | null> | DecodedToken | null

export interface CookieAction {
  cookieName: string
  actor: Actor
  action: 'slide' | 'clear'
  /** epoch seconds; present only when action === 'slide'. */
  newExp?: number
  /**
   * The resolved, STABLE login anchor (epoch seconds) to persist into the
   * re-issued token. Present only when action === 'slide'. Resolved once here
   * (claim → iat → nowSec) so the absolute cap stays anchored across slides;
   * if it were re-derived from `iat` on each slide the cap would never fire.
   */
  loginAt?: number
  /** original decoded claims to re-issue; present only when action === 'slide'. */
  claims?: Record<string, unknown>
}

export interface DecideInput {
  pathname: string
  /** cookieName → raw value (only present cookies). */
  cookies: Record<string, string | undefined>
  nowSec: number
  /** cookieName → decoder. */
  decoders: Record<string, Decoder | undefined>
}

export interface DecideResult {
  cookieActions: CookieAction[]
  redirectTo?: string
}

/**
 * `loginAt` must be a finite number. Legacy tokens issued before this deploy
 * carry no `loginAt`; substitute the token `iat`, then `nowSec`, so those
 * sessions roll over gracefully (slide) instead of being force-expired.
 * (Task 1's `evaluateSession` fails OPEN on NaN, so the substitution must
 * happen HERE, before calling it.)
 */
function resolveLoginAt(decoded: DecodedToken, nowSec: number): number {
  if (typeof decoded.loginAt === 'number' && Number.isFinite(decoded.loginAt)) return decoded.loginAt
  if (typeof decoded.iat === 'number' && Number.isFinite(decoded.iat)) return decoded.iat
  return nowSec
}

export async function decideForRequest(input: DecideInput): Promise<DecideResult> {
  const { pathname, cookies, nowSec, decoders } = input
  const cookieActions: CookieAction[] = []

  for (const { cookieName, actor } of COOKIE_ACTORS) {
    const raw = cookies[cookieName]
    if (raw == null || raw === '') continue
    const decoder = decoders[cookieName]
    if (!decoder) continue

    const decoded = await decoder(raw)
    // Any decode/verify failure (incl. expired `exp`) = logged out for this cookie.
    if (!decoded) {
      cookieActions.push({ cookieName, actor, action: 'clear' })
      continue
    }

    const loginAt = resolveLoginAt(decoded, nowSec)
    const decision = evaluateSession(actor, loginAt, nowSec)
    if (decision.action === 'expire') {
      cookieActions.push({ cookieName, actor, action: 'clear' })
    } else {
      cookieActions.push({
        cookieName,
        actor,
        action: 'slide',
        newExp: decision.newExp,
        loginAt,
        claims: decoded.claims,
      })
    }
  }

  let redirectTo: string | undefined
  // Only guarded PAGE requests redirect; APIs never do.
  const page = actorForPage(pathname)
  if (page && !pathname.startsWith('/api')) {
    const cookieName = COOKIE_ACTORS.find((c) => c.actor === page.actor)?.cookieName
    const slid = cookieActions.find((a) => a.cookieName === cookieName && a.action === 'slide')
    if (!slid) redirectTo = page.loginUrl
  }

  return { cookieActions, redirectTo }
}
