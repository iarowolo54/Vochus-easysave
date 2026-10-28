# Enrolment & OTP backend changes — UI contract

Backend hardening shipped for customer self-enrolment and the OTP flows. This
notes what the UI (`ui/zopa-standard`) can now rely on and the one behaviour
that changed. **No existing request/response shape was changed** except the two
removals called out below; the new endpoints are additive.

## New endpoints

### `POST /api/customer/phone-available`
Check a phone before the last enrol step. Call it when the phone field loses focus.
- Body: `{ phone }` — must be 11 digits starting with `0`, else `400`.
- Returns `{ available: boolean }` only (no customer details).
- Rate-limited per IP (~10/min) → `429` with `{ error }`.
- It is a convenience, **not** the guard — enrol still returns `409` on a duplicate phone.
- Suggested copy on `available:false`: "This number already has an account. Sign in instead."

### `GET /api/customer/enroll/invite?aid=<agentId>&ref=<inviteToken>`
Trust card for the welcome screen ("Invited by Tunde, your agent in Ikeja").
- No login. Rate-limited per IP → `429`.
- Returns `{ firstName, area, photo }` where `photo` is a small downscaled
  WebP data URL (or `null` if the agent has no photo). It is **not** the full
  base64 photo column.
- `404` when the invite/agent can't be resolved. Pass `ref` when you have the
  invite token, otherwise `aid`.

## Changed behaviour the UI should handle

- **`POST /api/otp/send` no longer returns `_devCode`.** The code is delivered
  only by SMS/email now. The agent enrol page already reads it behind an
  `if (data._devCode)`, so it degrades cleanly — just remove any UI that shows
  the dev code. SMS/email delivery must actually work for onboarding.
- **`POST /api/customer/email-otp` (send) is throttled** → may return `429`
  ("a code was just sent…"/"too many codes…"). Show the message; keep the
  resend button disabled for ~60s.
- **`POST /api/customer/email-otp/verify`** now locks the code after **5 wrong
  attempts** (`400` "Too many incorrect attempts. Request a new code."). After
  that the user must request a new code.
- **`POST /api/customer/enroll`** now enforces server-side, returning `400 { error }`:
  - email must be verified first (via the email-OTP flow, within 30 min) →
    `"Confirm your email first"`.
  - phone 11 digits starting `0`; valid email; address ≥ 8 chars; emergency
    contact phone must differ from the customer's; password ≥ 6.
  The UI already enforces these, so valid submissions are unaffected; this only
  closes direct-POST bypasses.
