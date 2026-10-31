# Session Expiry & Idle Timeout — Design

**Date:** 2026-10-31
**Author:** session hardening pass
**Apps:** `vochus-easysave` (this repo) + `vochus-giftcard` (sibling repo; owner deploys it)

## Intent & why

A super admin — who holds every money control (withdrawals, redemptions, loan
approvals, treasury) — currently gets a session that effectively never ends:
the NextAuth JWT defaults to a **30-day** lifetime and the custom admin login
route sets the cookie to `maxAge: 60*60*24*30` explicitly, and nothing logs an
idle admin out in a browser. If an admin walks away from an unlocked machine,
or a laptop is stolen, the attacker has up to a month of full access. Agents
and customers have the same 30-day exposure. This is the single highest-value
auth hardening available and the owner flagged it directly.

The goal: sessions that **expire on inactivity (idle)** and that have an
**absolute maximum lifetime** regardless of activity, with durations scaled to
risk — tightest for admins, looser (but bounded) for the mobile-app users.

## Current state (verified in code)

Three independent auth systems (`.claude/rules/auth-security.md`):

| Actor | Token mint | Current lifetime | Idle logout today |
|---|---|---|---|
| **Super admin** | `src/app/api/admin-auth/login/route.ts` hand-mints via `next-auth/jwt` `encode()` (no `maxAge` → 30d exp), cookie `maxAge` 30d. Reads via `adminAuthOptions` (`src/lib/auth-admin.ts`, `strategy:'jwt'`, no maxAge). | **30 days** | **None** — `superadmin/layout.tsx` has no idle component. |
| **Agent** | `src/lib/auth.ts` NextAuth `strategy:'jwt'`, no maxAge. | **30 days, sliding** | `IdleTimeout.tsx` (5 min) but **only inside the Flutter app** (`window.__vochusApp` gate) and **client-side only** — the server JWT stays valid 30 days. |
| **Customer** | `src/lib/customer-auth.ts` jose, `EXPIRY='30d'`, cookie maxAge 30d. | **30 days (absolute — does expire)** | `CustomerIdleTimeout` → same app-gated client component. |

No `middleware.ts` exists in either repo. Gift-card has the same admin custom
login route, the same `superadmin/layout.tsx`, and the same jose customer token
(30d); it has **no agent** system.

## Policy (owner-approved)

| Actor | Idle timeout | Absolute cap |
|---|---|---|
| Super admin | **15 min** | **8 hours** |
| Agent | **60 min** | **7 days** |
| Customer | **60 min** | **7 days** |

- **Idle** = signed out after this long with no authenticated activity.
- **Absolute cap** = forced re-login this long after login, even while active.
- Gift-card: admin + customer get the same numbers as above.

## Mechanism (engineering decision)

A single **Next.js `middleware.ts`** per app is the uniform enforcement point.
It is the only place that, on *every* authenticated request, can (a) run
regardless of how the client polls, (b) re-issue the cookie to implement a true
*sliding* idle window, and (c) redirect a page request to the right login
screen on expiry. Centralising the policy in one tested file beats scattering
it across NextAuth callbacks, three login routes, and client pollers.

### Shared policy module — `src/lib/session-policy.ts` (pure, tested)

```ts
export type Actor = 'admin' | 'agent' | 'customer'
export const IDLE_SECONDS:     Record<Actor, number>  // admin 900, agent/customer 3600
export const ABSOLUTE_SECONDS: Record<Actor, number>  // admin 28800, agent/customer 604800

// Pure decision function — the unit-tested core.
// `loginAt` and `now` are epoch SECONDS.
export function evaluateSession(actor: Actor, loginAt: number, now: number):
  | { action: 'slide'; newExp: number }   // valid: refresh cookie, exp = now + IDLE
  | { action: 'expire' }                   // absolute cap exceeded
```

Idle itself is enforced by the token's own `exp` (a decode/verify failure on an
expired token *is* the idle timeout). `evaluateSession` adds the **absolute
cap** check and computes the new sliding `exp`. Because idle is the JWT `exp`,
an expired-but-decodable check isn't needed — middleware treats any
verify/decode failure as "no valid session."

### Token claims

Every session token carries a stable **`loginAt`** (epoch seconds, set once at
login, never advanced on slide). For NextAuth tokens it rides in the JWT
payload; for the customer jose token it's an explicit claim. The absolute cap is
`loginAt + ABSOLUTE_SECONDS[actor]`.

### Middleware flow (per request, matched paths only)

1. Skip auth endpoints (`/api/auth/*`, `/api/admin-auth/*`, `/api/customer/auth/*`),
   `_next`, static assets, and public pages — matcher-scoped.
2. Detect the session cookie present for the route group and decode it:
   - admin/agent → `next-auth/jwt` `decode` (edge-safe)
   - customer → `jose` `jwtVerify` (edge-safe)
3. Decode/verify fails (incl. expired `exp`) → treat as logged out: clear the
   cookie; **page** request → redirect to that actor's login; **API** request →
   let it through cookie-less so the route's own auth check returns 401 (no new
   coupling to middleware).
4. Decode OK → `evaluateSession(actor, loginAt, now)`:
   - `expire` → clear cookie, redirect/allow-401 as in step 3.
   - `slide` → re-encode the **same claims** with `exp = newExp` (same
     `encode`/`SignJWT` the login route uses, so the shape NextAuth/jose expect
     round-trips exactly) and set the refreshed cookie (`maxAge =
     IDLE_SECONDS`) on the forwarded response.

Edge-runtime safe: only `jose` / `next-auth/jwt` crypto, **no Prisma**.

**Known caveat (documented, acceptable):** middleware governs *expiry only*,
not revocation. The agent `tokenVersion` password-change revocation and admin
role checks still run in the NextAuth `session` callback / `requireSuperAdmin`
on reads — middleware never weakens them; it only shortens lifetimes.

### Login routes (set `loginAt` + short initial cookie)

- `admin-auth/login/route.ts`: pass `maxAge: IDLE_SECONDS.admin` to `encode()`,
  add `loginAt` to the token, set cookie `maxAge: IDLE_SECONDS.admin`.
- `src/lib/auth.ts` (agent) jwt callback: stamp `loginAt` on first issue; set
  `authOptions.session = { maxAge: IDLE_SECONDS.agent }` as a backstop.
- `src/lib/auth-admin.ts`: `session = { maxAge: IDLE_SECONDS.admin }` backstop.
- `src/lib/customer-auth.ts`: `signCustomerToken` sets `exp = now + IDLE`,
  adds `loginAt`; `customerCookieOptions` `maxAge = IDLE_SECONDS.customer`.
  (The login route already calls both.)

### Client idle UX (optional polish, not the enforcement)

The existing `IdleTimeout` "Still there?" modal is a nicety gated to the app.
Enforcement is now server-side, so the client components are left as-is this
pass. Follow-up (noted, not built): un-gate the modal for the admin browser so
admins see the 15-min countdown instead of a silent redirect.

## Scope

**In:** middleware + policy module + login-route/token changes in **both** repos
(gift-card: admin + customer only). Tests for the pure policy core and the
middleware decision. **Out:** changing the client idle modals; MFA; refresh
tokens; device-session changes.

## Goals / non-goals / anti-goals

- **Goal:** idle + absolute expiry enforced server-side for all actors, tight
  for admins.
- **Non-goal:** re-authentication UX redesign, remember-me, step-up auth.
- **Anti-goal:** logging an *active* admin out mid-task (the 15-min clock must
  reset on real activity — hence sliding, not fixed), and any change that could
  weaken the existing `tokenVersion`/role revocation.

## Resolutions from builder-check (2026-10-31)

1. **Edge-runtime must be proven first (Task 1 = spike).** Next 16.2.6 +
   next-auth 4.24.14 is off-spec; before anything else, a throwaway
   `middleware.ts` must `decode()` a real admin cookie and `jwtVerify()` a real
   customer cookie on this build, after reading Next 16's middleware docs under
   `node_modules/next/dist/docs/`. If `next-auth/jwt` won't run on edge here,
   the fallback is `export const config = { runtime: 'nodejs' }` middleware (Next
   16 supports Node middleware) — decided by the spike, not assumed.

2. **"Activity" = real user interaction, via a heartbeat.** Server-side sliding
   alone fires only on matched requests, which would log out an active admin
   mid-form. Add a tiny `SessionKeepAlive` client (mounted in the agent, admin,
   and customer layouts) that, on *throttled genuine user-input events*
   (pointer/key/touch, at most once per ~90s), GETs `/api/session/ping` — a
   matched, session-required route returning 204 whose only job is to pass
   through middleware and slide the cookie. Real inactivity → no pings → idle
   expiry. (Un-gating the visible "Still there?" modal for the admin browser is
   a noted follow-up, not this pass — the silent redirect is acceptable; the
   heartbeat is the correctness fix.)

3. **Cookie-centric processing (resolves the API path→actor mapping).**
   Middleware does **not** map API paths to actors. On every matched request it
   independently processes whichever of the three cookies are present:
   decode → within cap? slide (re-set that cookie) : clear it. Only **protected
   page** requests need a path→actor map, and only to pick the right login
   redirect:
   - `/dashboard/*` → agent (login `/login`)
   - `/superadmin/*` except `/superadmin/login` → admin
   - `/customer/*` except the public customer pages → customer (login `/customer/login`)
   API requests are never redirected; with the cookie cleared, the route's own
   auth check returns its usual 401 (no new client coupling). Matcher:
   `['/dashboard/:path*', '/superadmin/:path*', '/customer/:path*', '/api/:path*']`,
   with auth endpoints (`/api/auth/*`, `/api/admin-auth/*`, `/api/customer/auth/*`),
   `/session/ping`-adjacent exclusions, and the login/public pages handled by
   early-return inside middleware. The spike confirms the exact public customer
   pages (`/customer/login`, enroll/register/reset) to exclude.

4. **Two slide mechanisms coexist deliberately.** NextAuth's `SessionProvider`
   (`providers.tsx`, `superadmin/layout.tsx`, `refetchOnWindowFocus`) already
   rolls the agent/admin cookie on tab focus. Set `session.maxAge =
   IDLE_SECONDS[actor]` on **both** NextAuth configs so that refresh agrees with
   the idle window, and preserve `loginAt` in the `jwt` callback so the absolute
   cap survives a NextAuth-side refresh (middleware still enforces the cap on the
   next matched request). Customer has no SessionProvider — middleware is its
   only slide, which the heartbeat covers.

5. **Cookie attributes: standardise on the login-route set** — `httpOnly`,
   `sameSite:'lax'`, `path:'/'`, `secure: NODE_ENV==='production'` — and have
   middleware re-issue each cookie with byte-identical attributes and name
   (`next-auth.session-token` / `next-admin-auth.session-token` / `customer_token`).
   The `secure:false` hardcoded in `auth-admin.ts` cookie options is a latent
   bug; align it to `secure: production` in the same pass (behind https in prod
   via nginx, so safe). Flag, don't expand scope further.

6. **Version-lock constraint (document).** Round-tripping `encode(decode(token))`
   between middleware and `getServerSession` works only because next-auth **v4**
   derives the JWE key from the secret with a constant salt. A future bump to
   next-auth v5 breaks this; note it in `session-policy.ts` and
   `auth-security.md`.

7. **Customer token interface change.** `CustomerSession` and
   `verifyCustomerToken`'s return gain `loginAt: number`; the absolute-cap check
   lives in middleware (jose `verifyCustomerToken` only validates `exp`).
   `signCustomerToken` sets `exp = now + IDLE_SECONDS.customer` and stamps
   `loginAt`.

## Risks

- **Middleware + NextAuth cookie ownership:** excluded `/api/auth/*` &
  `/api/admin-auth/*` so NextAuth owns its own endpoints; middleware refreshes
  only elsewhere. Must preserve exact claim shape on re-encode.
- **Edge runtime:** no Prisma in middleware (verified not needed).
- **Lockout regression:** a too-aggressive matcher could redirect-loop on the
  login page — matcher must exclude login pages and auth APIs; test this.
- **Two SQLite PM2 instances / nothing DB here:** middleware is stateless, so
  no new contention.
