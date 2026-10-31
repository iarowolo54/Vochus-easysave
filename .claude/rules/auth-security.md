# Auth & security

There are **three independent auth systems**. Know which one a route belongs to.

| Actor | Mechanism | File | Cookie |
|---|---|---|---|
| Agent / sub-agent | NextAuth (JWT, credentials) | `src/lib/auth.ts` | `next-auth.session-token` |
| Super admin / staff | NextAuth (separate config) | `src/lib/auth-admin.ts` | `next-admin-auth.session-token` |
| Customer | Hand-rolled JWT via `jose` | `src/lib/customer-auth.ts` | `customer_token` |

## Session expiry (idle + absolute cap)

- **All three sessions expire.** Durations live in one place — `src/lib/session-policy.ts` (`IDLE_SECONDS`/`ABSOLUTE_SECONDS`): super admin 15 min idle / 8 h absolute; agent & customer 60 min idle / 7 days absolute. Never hardcode these elsewhere.
- **The Next 16 Proxy (`src/proxy.ts`) is the enforcement point** (Next 16 renamed "middleware" to Proxy; one per app, Node runtime). On every matched request it decodes each session cookie, slides the idle window (re-issues the cookie with a fresh `exp`), enforces the absolute cap off a stable `loginAt` claim stamped at sign-in, and on expiry clears the cookie *and strips it from the forwarded request* so the same request can't still read it. It also preserves the admin role gate.
- **Defense-in-depth:** the absolute cap is re-checked where the token is trusted — the NextAuth `session` callbacks (which the proxy excludes at `/api/*-auth/session`) and `verifyCustomerToken` — via the pure `isPastAbsoluteCap`. A missing/legacy `loginAt` is never force-expired (falls back to `iat`, persisted once).
- **Version lock:** the proxy re-encodes NextAuth tokens with `next-auth/jwt` `encode(decode(...))`, which round-trips only because next-auth **v4** derives the JWE key from a constant salt. A bump to next-auth v5 breaks proxy↔`getServerSession` interop — revisit then.

## Rules

- **Authorization is server-side.** Derive the actor from the session/token on every request; never trust an id or role from the client body. The client only hides UI.
- **Admin routes must check the role, not just a session.** Require `(session.user as any).role === 'superadmin'`. Checking only `session?.user` is a known hole: the agent and admin NextAuth configs share `NEXTAUTH_SECRET`, so a non-admin token placed in the admin cookie passes a bare session check.
- **Own-the-data check.** For any `customerId`/`agentId`/planId/loanId from the request, query with the owner in the `where` (e.g. `{ id, agentId: actor.id }`) and 404 if not found.
- **No hardcoded secret fallbacks.** `process.env.NEXTAUTH_SECRET ?? 'vochus-...'` is a bug — fail closed instead. (Several files currently do this; don't add more, and prefer fixing when you touch them.)
- **Tokens & OTPs:** generate with `node:crypto` (not `Math.random`); check ownership; limit attempts; never log them in plaintext.
- **Secrets never logged or returned.** No passwords, tokens, codes, or `.env` values in logs or responses.

## Payments (Paystack — real money)

- Webhook (`api/webhooks/paystack`, `api/paystack/webhook`): reject an empty secret, verify the signature with `crypto.timingSafeEqual`, and re-verify the transaction via the Paystack API before crediting.
- `customer/paystack/verify`: bind the reference to the session customer and check amount/currency against a server-side record.
- Payouts/withdrawals use a **verified** account, not bank details supplied in the request. Debit balances atomically (see `database.md`).
