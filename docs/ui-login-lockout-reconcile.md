# UI reconcile — customer login lockout + OTP unlock

**For:** the agent handling the Zopa customer-UI redesign (`ui/zopa-standard`).
**Status:** backend + a *minimal, unstyled* UI shipped to production (2026-10-27). This doc is the UI polish + merge-reconcile that remains. **UI only — do not change the API, endpoints, or response shapes below.**

## What shipped
A new customer-login lockout: after **4 failed password attempts** the account is **hard-locked** (full freeze — password *and* biometric refused). The only way back in is a one-time code (email for link-registered customers, SMS for agent-registered), after which the customer re-enters their password. This is a confirmed client requirement — don't soften it.

Two UI touch-points were added, deliberately plain, to be restyled to match Zopa:

| File | What it is | Action |
|---|---|---|
| `src/app/customer/unlock/page.tsx` | **New** unlock screen (code entry, masked destination, resend-with-cooldown, loading/empty/error states) | Restyle to Zopa. Keep all behavior + the API contract below. |
| `src/app/customer/login/LoginForm.tsx` | Existing login form, with a small added hook | Preserve the two behaviors below when you restyle/merge. |

## The merge conflict to expect
`LoginForm.tsx` is the one real conflict point when `ui/zopa-standard` merges `main`. The redesign rewrites this component; these two additions **must survive**:

1. **On HTTP `423` from `POST /api/customer/auth/login`**, redirect to the unlock flow with the phone:
   ```ts
   if (res.status === 423) { router.push(`/customer/unlock?phone=${encodeURIComponent(phone.trim())}`); return }
   ```
   This exists in **both** the password path and the biometric path (`__vochusPerformBiometricSignin`) — keep both.
2. **When the login URL has `?unlocked=1`**, show a success notice ("Account unlocked — please sign in."). Set from the mount effect reading `window.location.search`.

## API contract the UI must keep working against (do not change these)
- **Login** `POST /api/customer/auth/login` → `423 { error, locked: true }` when locked. (Also `401` invalid, `429` + `Retry-After` for the IP rule.)
- **Request a code** `POST /api/customer/auth/unlock/request` `{ phone }`
  - success → `200 { ok: true, channel: "email" | "sms", sentTo: "<masked>" }`
  - rate-limited → `429 { error, retryAfterSeconds }` (60s resend cooldown + a daily cap)
  - neutral (unknown/not-locked account, nothing sent) → `200 { ok: true }` with no `channel`
- **Verify a code** `POST /api/customer/auth/unlock/verify` `{ phone, code }`
  - success → `200 { ok: true }` — then navigate to `/customer/login?unlocked=1`
  - failure → `400 { error: "Invalid or expired code" }`
- The code is **6 digits, numeric**. The server never returns the code.

## Required UX (keep in the restyle)
- Auto-request a code on entering `/customer/unlock` (phone comes from the `?phone=` query).
- Show where the code was sent (the masked `sentTo`), e.g. `j***@example.com` / `*******5678`.
- **Resend** control with a countdown while on cooldown; on `429`, show a friendly "try again in Ns" using `retryAfterSeconds`.
- Handle **loading / empty / error** states (not just the happy path).
- A "Back to login" link.

## Constraints (house rules)
- Mobile apps are Flutter **WebViews** of this site: must work at **~360px**, use a **numeric keyboard** for the code input, large tap targets, no hover reliance.
- Match the existing styling approach (plain CSS + CSS variables like `--bg`, `--card`, `--g`); no new styling system.
- Server-only logic/secrets stay out of `'use client'` components (both these files are client components calling the API routes — fine).

## Done when
- `/customer/unlock` matches the Zopa design and still drives request → verify → back-to-login.
- The login form, in its redesigned form, still redirects on `423` and shows the `?unlocked=1` notice.
- Verified at 360px with an on-screen keyboard.
