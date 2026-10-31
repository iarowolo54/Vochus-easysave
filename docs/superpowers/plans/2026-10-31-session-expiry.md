# Session Expiry & Idle Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce server-side idle timeout + absolute session cap for all three actors in both apps (admin 15m/8h, agent & customer 60m/7d), replacing the current 30-day never-ending sessions.

**Architecture:** A per-app Next.js `middleware.ts` is the uniform enforcement point: on every matched request it decodes whichever session cookies are present, enforces the absolute cap, and slides the idle window by re-issuing the cookie. A pure `session-policy.ts` module holds the durations + the tested decision function. Login routes/token mints stamp a fixed `loginAt` and short cookies. A small activity-triggered heartbeat keeps *active* users from being logged out mid-task.

**Tech Stack:** Next.js 16.2.6 (App Router), next-auth 4.24.14 (`next-auth/jwt` encode/decode), jose 4.x, TypeScript. Tests via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-31-session-expiry-design.md`

## Global Constraints

- Durations come ONLY from `src/lib/session-policy.ts` — no inline magic numbers. admin: IDLE 900s / ABSOLUTE 28800s; agent & customer: IDLE 3600s / ABSOLUTE 604800s.
- `loginAt` is epoch **seconds**, set once at login, never advanced on slide.
- **No Prisma in middleware** (edge/node-safe crypto only: `jose`, `next-auth/jwt`).
- Middleware governs **expiry only** — must not weaken the existing agent `tokenVersion` revocation (`auth.ts` session callback) or admin role checks (`requireSuperAdmin`).
- Cookie attributes on every (re-)issue: `httpOnly`, `sameSite:'lax'`, `path:'/'`, `secure: process.env.NODE_ENV==='production'`; names exactly `next-auth.session-token` / `next-admin-auth.session-token` / `customer_token`.
- No new `any`/`as any`; secrets fail-closed via `requireEnv`. `npx tsc --noEmit` is the type gate (baseline 23 errors — leave no new ones).
- EasySave (this repo) is the only app I deploy; gift-card changes are built here but the owner deploys that repo.

## Review Focus

- **Redirect loop:** an expired admin cookie on a `/superadmin/*` page must redirect to `/superadmin/login` which itself must NOT be guarded → Task 2 excludes login/public pages; test asserts the login path early-returns.
- **Garbage/stale cookie never 500s:** a malformed or wrong-secret cookie must be treated as logged-out (clear + redirect/allow), never throw → Task 1 `evaluateSession` is pure; Task 2 wraps decode in try/catch, tested with a junk token.
- **Absolute-cap boundary:** `evaluateSession` at exactly `loginAt + ABSOLUTE` and one second past → Task 1 tests both edges.
- **WebView resume after idle:** a customer app backgrounded > 60 min then resumed must cleanly require re-login (cookie idle-expired), not hang → Task 3 sets `exp = now + IDLE`; Task 1 covers the expired-token decision.
- **Heartbeat must not keep a walked-away session alive:** the ping fires only on genuine user-input events, throttled, never on a timer → Task 4 test asserts no ping without an input event.

---

### Task 1: `session-policy.ts` — pure policy + decision core

**Files:**
- Create: `src/lib/session-policy.ts`
- Test: `tests/session-policy.test.ts`

**Interfaces:**
- Produces: `type Actor = 'admin'|'agent'|'customer'`; `IDLE_SECONDS: Record<Actor,number>`; `ABSOLUTE_SECONDS: Record<Actor,number>`; `evaluateSession(actor: Actor, loginAt: number, nowSec: number): { action:'slide'; newExp:number } | { action:'expire' }`; `actorForPage(pathname: string): { actor: Actor; loginUrl: string } | null` (null = public/unguarded page).

- [ ] **Step 1: Write failing tests** — `evaluateSession`: within cap → `{action:'slide', newExp: nowSec + IDLE_SECONDS[actor]}`; at `nowSec == loginAt + ABSOLUTE` → still slide; at `+1s` past → `{action:'expire'}`; for each actor the constants match the spec. `actorForPage`: `/dashboard/x`→agent `/login`; `/superadmin/x`→admin `/superadmin/login`; `/superadmin/login`→null; `/customer/dashboard`→customer `/customer/login`; `/customer/login|enroll|forgot-password|unlock`→null; `/`→null; `/login`→null.
- [ ] **Step 2: Run tests, verify they fail** (`npx tsx --test tests/session-policy.test.ts`).
- [ ] **Step 3: Implement** the constants and both pure functions. Document the next-auth-v4 key-derivation version-lock in a top comment.
- [ ] **Step 4: Run tests, verify pass; run full suite.**
- [ ] **Step 5: Commit.**

### Task 2: EasySave `middleware.ts` (runtime spike first)

**Files:**
- Create: `src/middleware.ts`
- Test: `tests/session-middleware-helpers.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: the running middleware (no exported API for other tasks).

- [ ] **Step 1 (SPIKE):** Read Next 16 middleware docs under `node_modules/next/dist/docs/`. In a throwaway `middleware.ts`, `decode({token, secret})` a real admin cookie and `jwtVerify` a real customer cookie, logging success. Try edge first; if `next-auth/jwt` fails on edge, add `export const config = { runtime: 'nodejs' }`. Record which runtime works in the ledger. Delete the throwaway probe before Step 3.
- [ ] **Step 2: Write failing tests** for the extracted pure helper `decideForRequest({ pathname, cookies, nowSec })` → list of `{ cookieName, action:'slide'|'clear', token? }` plus optional `{ redirectTo }`: valid admin cookie on `/superadmin/x` → slide, no redirect; expired/garbage admin cookie on `/superadmin/x` → clear + redirect `/superadmin/login`; same on `/api/admin/...` → clear, no redirect; no cookie on `/superadmin/login` → no-op (public). (Decoding is injected as a param so the helper is pure/testable.)
- [ ] **Step 3: Implement** `middleware.ts`: matcher `['/dashboard/:path*','/superadmin/:path*','/customer/:path*','/api/:path*']`; skip `/api/auth`, `/api/admin-auth`, `/api/customer/auth`; for each present cookie decode (try/catch; agent+admin via `next-auth/jwt` decode, customer via `verifyCustomerToken`), run `evaluateSession`, and `encode`/`signCustomerToken`-re-issue on slide (preserving all claims + `loginAt`) or clear on expire, with the standard cookie attributes; for a guarded **page** request (`actorForPage`) whose actor has no valid cookie, redirect to its login. Use the runtime the spike proved.
- [ ] **Step 4:** Run helper tests + full suite; `npx tsc --noEmit` (no new errors).
- [ ] **Step 5: Commit.**

### Task 3: Token mints stamp `loginAt` + short lifetimes

**Files:**
- Modify: `src/lib/customer-auth.ts`, `src/lib/auth.ts`, `src/lib/auth-admin.ts`, `src/app/api/admin-auth/login/route.ts`
- Test: `tests/customer-auth-token.test.ts`

**Interfaces:**
- Consumes: Task 1 `IDLE_SECONDS`.
- Produces: `CustomerSession` gains `loginAt: number`; tokens across all actors carry `loginAt` (seconds) + `exp = iat + IDLE`.

- [ ] **Step 1: Write failing tests** — `signCustomerToken` then `verifyCustomerToken`: payload includes `loginAt` (≈ now, seconds) and the token `exp - iat === IDLE_SECONDS.customer`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — customer-auth: add `loginAt` to `CustomerSession`, set it in `signCustomerToken`, set `EXPIRY`/`setExpirationTime` to `IDLE_SECONDS.customer`, cookie `maxAge = IDLE_SECONDS.customer` (login route already passes loginAt via the session object — set `loginAt: Math.floor(Date.now()/1000)` there). agent `auth.ts`: in `jwt` callback set `token.loginAt ??= Math.floor(Date.now()/1000)`; set `authOptions.session = { maxAge: IDLE_SECONDS.agent }`. `auth-admin.ts`: `session = { maxAge: IDLE_SECONDS.admin }`; fix cookie `secure` to `process.env.NODE_ENV==='production'`. admin `login/route.ts`: add `loginAt` to the encoded token, `encode({ ..., maxAge: IDLE_SECONDS.admin })`, cookie `maxAge: IDLE_SECONDS.admin`.
- [ ] **Step 4:** Run tests + full suite + tsc.
- [ ] **Step 5: Commit.**

### Task 4: `/api/session/ping` + `SessionKeepAlive` heartbeat

**Files:**
- Create: `src/app/api/session/ping/route.ts`, `src/components/SessionKeepAlive.tsx`
- Modify: `src/app/dashboard/layout.tsx`, `src/app/superadmin/_components/AdminShell.tsx` (or `superadmin/layout.tsx`), `src/app/customer/layout.tsx`
- Test: `tests/session-keepalive.test.tsx` (throttle/event logic if testable) — else a documented manual check in the report.

**Interfaces:**
- Consumes: nothing (ping is a bare matched GET returning 204).

- [ ] **Step 1:** `GET /api/session/ping` → `new NextResponse(null, { status: 204 })`. It carries no logic; middleware slides the cookie as it passes. (It IS matched by `/api/:path*`.)
- [ ] **Step 2: Write failing test** for the pure throttle helper in `SessionKeepAlive` (`shouldPing(lastPingMs, nowMs, minGapMs)` → true only if gap ≥ minGap): asserts no ping before the gap elapses.
- [ ] **Step 3: Implement** `SessionKeepAlive` ('use client'): listen to `pointerdown/keydown/touchstart` (passive), and on an event, if `shouldPing` (min gap ~90s), `fetch('/api/session/ping')`. No timer-based ping. Mount once in each of the three layouts.
- [ ] **Step 4:** Run tests + full suite + tsc.
- [ ] **Step 5: Commit.**

### Task 5: Mirror into `vochus-giftcard` (admin + customer; no agent)

**Files (in `/Users/mac/Developer/vochus-giftcard`):**
- Create: `src/lib/session-policy.ts` (admin+customer only), `src/middleware.ts`, `src/app/api/session/ping/route.ts`, `src/components/SessionKeepAlive.tsx`, `tests/session-policy.test.ts`
- Modify: `src/lib/customer-auth.ts`, `src/lib/auth-admin.ts`, `src/app/api/admin-auth/login/route.ts`, `src/app/superadmin/layout.tsx`, `src/app/customer/layout.tsx`

- [ ] **Step 1:** Port Tasks 1–4 to gift-card, dropping all agent paths (`/dashboard`, `auth.ts`). `actorForPage` handles `/superadmin/*` + `/customer/*` only; matcher drops `/dashboard`. Confirm gift-card's public customer pages from its `src/app/customer/` listing.
- [ ] **Step 2: Write + run** `tests/session-policy.test.ts` for the two actors.
- [ ] **Step 3:** Run gift-card's test suite + `npx tsc --noEmit` in that repo.
- [ ] **Step 4: Commit** in the gift-card repo (separate working tree).

### Task 6: Document the version-lock + update memory

**Files:**
- Modify: `.claude/rules/auth-security.md`
- [ ] Add one line under the session table noting idle/absolute policy + the next-auth-v4 key-derivation lock that lets middleware re-encode. Commit.
