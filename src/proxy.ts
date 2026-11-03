/**
 * Next.js 16 Proxy (formerly "middleware" — renamed framework-wide in v16; see
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md). Only ONE
 * proxy file is supported per project and it runs on the Node.js runtime by
 * default (the `runtime` config option is not available in a proxy file and
 * throws if set), so `next-auth/jwt` and `jose` both run here directly.
 *
 * Responsibilities:
 *  1. Session expiry — idle (sliding cookie `exp`) + absolute cap — for all
 *     three actors, enforced server-side via the pure `decideForRequest` core.
 *  2. Authorization (preserved from the prior proxy, REQUIRED by
 *     .claude/rules/auth-security.md): admin API + superadmin pages must check
 *     the role, not merely a decodable cookie. Only `superadmin` or `staff`
 *     roles are admitted; per-area permissions are enforced downstream in the
 *     route guards (`requirePermission` / `requireAdminArea`). The agent and
 *     admin NextAuth configs share NEXTAUTH_SECRET, so an agent token placed in
 *     the admin cookie decodes fine and must still be rejected on role.
 *
 * No Prisma here (not edge/node-proxy friendly and unnecessary). Secret is read
 * fail-closed via requireEnv.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decode, encode } from 'next-auth/jwt'
import { requireEnv } from '@/lib/env'
import { isDevPreviewPath } from '@/lib/dev-preview'
import { isAdminAreaRole } from '@/lib/permissions'
import { verifyCustomerToken, signCustomerToken, type CustomerSession } from '@/lib/customer-token'
import { IDLE_SECONDS, type Actor } from '@/lib/session-policy'
import {
  decideForRequest,
  strippedCookieHeader,
  AGENT_COOKIE,
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  type Decoder,
  type CookieAction,
} from '@/lib/session-middleware'

const SECRET = requireEnv('NEXTAUTH_SECRET')

// In production (https) NextAuth names the agent cookie with a `__Secure-`
// prefix; dev uses the bare name. We accept whichever is actually present and
// re-issue under that same name.
const AGENT_COOKIE_SECURE = `__Secure-${AGENT_COOKIE}`

/** Auth endpoints own their own cookies — never touch them. */
function isAuthEndpoint(pathname: string): boolean {
  return (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/admin-auth') ||
    pathname.startsWith('/api/customer/auth')
  )
}

function isAdminApi(pathname: string): boolean {
  return (
    pathname.startsWith('/api/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/superadmin/') ||
    pathname === '/api/superadmin'
  )
}

/** Pull `loginAt`/`iat` off an arbitrary claims bag without introducing `any`. */
function numClaim(claims: Record<string, unknown>, key: string): number | undefined {
  const v = claims[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Decoder for the next-auth v4 JWE (agent + admin). */
const nextAuthDecoder: Decoder = async (raw) => {
  // `decode` THROWS on a malformed/garbage JWE (not just returns null), e.g. a
  // stale, truncated, or key-rotated cookie. Treat any failure as logged out so
  // a bad cookie never 500s the request (decideForRequest also catches, belt
  // and suspenders).
  let token: Awaited<ReturnType<typeof decode>>
  try {
    token = await decode({ token: raw, secret: SECRET })
  } catch {
    return null
  }
  if (!token) return null
  const claims = token as Record<string, unknown>
  return { loginAt: numClaim(claims, 'loginAt'), iat: numClaim(claims, 'iat'), claims }
}

/** Decoder for the jose customer token. */
const customerDecoder: Decoder = async (raw) => {
  const session = await verifyCustomerToken(raw)
  if (!session) return null
  // The runtime payload carries iat (and, after Task 3, loginAt); the typed
  // return narrows them away, so widen precisely (not `any`).
  const claims = session as CustomerSession & { iat?: number; loginAt?: number }
  return {
    loginAt: typeof claims.loginAt === 'number' ? claims.loginAt : undefined,
    iat: typeof claims.iat === 'number' ? claims.iat : undefined,
    claims: claims as unknown as Record<string, unknown>,
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Leftover no-sign-in preview pages (they can linger on a server because deploys never delete files): refuse them.
  if (isDevPreviewPath(pathname)) return new NextResponse(null, { status: 404 })

  // 1. Let auth/login endpoints manage their own cookies, untouched.
  if (isAuthEndpoint(pathname)) return NextResponse.next()

  // 2. Resolve the agent cookie name actually present (secure prefix in prod).
  const presentAgentName = request.cookies.has(AGENT_COOKIE_SECURE)
    ? AGENT_COOKIE_SECURE
    : AGENT_COOKIE
  // Map the canonical cookie name used by the decision core → the real request
  // cookie name, so slide/clear re-issue under the correct name.
  const actualName: Record<string, string> = {
    [AGENT_COOKIE]: presentAgentName,
    [ADMIN_COOKIE]: ADMIN_COOKIE,
    [CUSTOMER_COOKIE]: CUSTOMER_COOKIE,
  }

  const cookies: Record<string, string | undefined> = {
    [AGENT_COOKIE]: request.cookies.get(presentAgentName)?.value,
    [ADMIN_COOKIE]: request.cookies.get(ADMIN_COOKIE)?.value,
    [CUSTOMER_COOKIE]: request.cookies.get(CUSTOMER_COOKIE)?.value,
  }

  const decoders: Record<string, Decoder> = {
    [AGENT_COOKIE]: nextAuthDecoder,
    [ADMIN_COOKIE]: nextAuthDecoder,
    [CUSTOMER_COOKIE]: customerDecoder,
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const { cookieActions, redirectTo, cookieStates } = await decideForRequest({ pathname, cookies, nowSec, decoders })

  // 3. Authorization overrides (role, not just a session) — preserved behaviour.
  // Key off the cookie's VALIDITY + claims, NOT a slide action: a valid admin
  // cookie on a non-heartbeat request (e.g. any admin API call) has no slide
  // action but is still an authorized session.
  const adminValid = cookieStates.find((s) => s.cookieName === ADMIN_COOKIE && s.status === 'valid')
  const adminRole = adminValid?.claims?.role
  const adminIsAdminArea = isAdminAreaRole(adminRole)

  if (isAdminApi(pathname)) {
    if (!adminValid) return applyCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookieActions, actualName)
    if (!adminIsAdminArea) return applyCookies(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookieActions, actualName)
  }

  // Superadmin pages: a valid-but-wrong-role token must also be bounced.
  let effectiveRedirect = redirectTo
  if (
    pathname.startsWith('/superadmin') &&
    !pathname.startsWith('/superadmin/login') &&
    !pathname.startsWith('/superadmin/accept-invite') &&
    adminValid &&
    !adminIsAdminArea
  ) {
    effectiveRedirect = '/superadmin/login'
  }

  // 4. Build the response and apply cookie slides/clears to it.
  // For the pass-through case, ALSO strip any cleared cookie from the Cookie
  // header forwarded downstream, so THIS request's handler sees the logged-out
  // state (closes the one-final-authenticated-response window on cap expiry).
  // Other actors' cookies stay intact. Redirects never reach a handler, so no
  // stripping is needed there.
  let res: NextResponse
  if (effectiveRedirect) {
    res = NextResponse.redirect(new URL(effectiveRedirect, request.url), 307)
  } else {
    const clearedNames = cookieActions
      .filter((a) => a.action === 'clear')
      .map((a) => actualName[a.cookieName] ?? a.cookieName)
    if (clearedNames.length > 0) {
      const headers = new Headers(request.headers)
      const stripped = strippedCookieHeader(request.headers.get('cookie'), clearedNames)
      if (stripped) headers.set('cookie', stripped)
      else headers.delete('cookie')
      res = NextResponse.next({ request: { headers } })
    } else {
      res = NextResponse.next()
    }
  }

  return applyCookies(res, cookieActions, actualName)
}

/**
 * Re-sign a next-auth token with a fresh idle exp, preserving all claims and
 * PERSISTING the resolved `loginAt`. encode stamps a fresh iat/exp from maxAge,
 * so we must write `loginAt` back explicitly — otherwise a token with no
 * `loginAt` claim would re-anchor to the new iat on every slide and the
 * absolute cap would never fire.
 */
async function reissueNextAuth(
  claims: Record<string, unknown>,
  actor: Actor,
  loginAt: number,
): Promise<string> {
  const payload = { ...claims }
  // encode stamps a fresh iat/exp from maxAge; drop the stale ones + jti.
  delete payload.iat
  delete payload.exp
  delete payload.jti
  payload.loginAt = loginAt
  return encode({ token: payload, secret: SECRET, maxAge: IDLE_SECONDS[actor] })
}

/**
 * Re-sign the customer jose token, carrying the resolved `loginAt` through so
 * the absolute cap stays anchored across slides (a fresh sign re-stamps iat).
 * When `CustomerSession` later gains a native `loginAt` field this must keep
 * passing it to signCustomerToken, not drop it.
 */
async function reissueCustomer(claims: Record<string, unknown>, loginAt: number): Promise<string> {
  const session: CustomerSession = {
    id: String(claims.id ?? ''),
    customerId: String(claims.customerId ?? ''),
    name: String(claims.name ?? ''),
    agentId: String(claims.agentId ?? ''),
    ...(typeof claims.tokenVersion === 'number' ? { tokenVersion: claims.tokenVersion } : {}),
  }
  return signCustomerToken(session, { loginAt, expSeconds: IDLE_SECONDS.customer })
}

async function applyCookies(
  res: NextResponse,
  actions: CookieAction[],
  actualName: Record<string, string>,
): Promise<NextResponse> {
  const secure = process.env.NODE_ENV === 'production'
  for (const action of actions) {
    const name = actualName[action.cookieName] ?? action.cookieName
    if (action.action === 'clear') {
      // Use an explicit expired Set-Cookie (not .delete): a `__Secure-`-prefixed
      // name (the agent cookie in prod) is IGNORED by browsers unless the
      // Set-Cookie also carries `Secure`, so .delete() wouldn't actually clear it.
      res.cookies.set({ name, value: '', maxAge: 0, path: '/', secure })
      continue
    }
    // slide: re-mint with a fresh idle exp, same name + standardised attributes.
    const claims = action.claims ?? {}
    const loginAt = action.loginAt ?? Math.floor(Date.now() / 1000)
    const value =
      action.actor === 'customer'
        ? await reissueCustomer(claims, loginAt)
        : await reissueNextAuth(claims, action.actor, loginAt)
    res.cookies.set({
      name,
      value,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      maxAge: IDLE_SECONDS[action.actor],
    })
  }
  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/superadmin/:path*', '/customer/:path*', '/api/:path*', '/dev-preview/:path*'],
}
