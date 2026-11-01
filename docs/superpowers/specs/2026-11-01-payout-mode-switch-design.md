# Payout Mode Switch (Automatic / Manual) — Design

**Date:** 2026-11-01
**Author:** payout-resilience pass
**App:** `vochus-easysave` (this repo only — gift-card has no agent/withdrawal system; out of scope)

## Intent & why

Paystack transfers go down (right now, for compliance checks), and while they
are down **no money can leave the platform** — agents can't be paid their
commission and customers can't redeem savings plans to a bank. The business
still needs to pay people during these windows.

Today every payout is already a two-step, human-gated flow: the money is
reserved when the request is made, and a super admin later **approves** it,
which is the moment the Paystack transfer fires. The gap is only this: when
Paystack is unavailable, the approve button has nowhere to send the money, and
there is no way to record "I paid this person by hand."

This feature adds a **super-admin-controlled Payout Mode**. In **Manual** mode,
approving a payout **skips Paystack entirely** — the admin pays the recipient
from the company bank out-of-band and records it as paid in the panel — and a
chain of **email/SMS notifications** keeps everyone informed, because a human
is now in the loop and payouts may sit for hours. In **Automatic** mode nothing
changes from today's behaviour, including no extra notifications.

## Current state (verified in code)

Two outbound-money flows, each already human-gated and holding funds at
request time:

| Flow | Request (holds funds) | Admin approve = sends money | States |
|---|---|---|---|
| **Agent commission payout** | `src/app/api/agent/withdrawal/route.ts` POST — atomically debits `commissionBalance`, creates `AgentWithdrawal` `status:'Pending'` (schema `prisma/schema.prisma:496-518`). | `src/app/api/admin/agent-withdrawal/[id]/route.ts` PATCH `approve` — Paystack `createRecipient`+`initiateTransfer` (`:94-108`). `reject` already refunds (`:32-56`). | `Pending, Processing, AwaitingOTP, Finalizing, Approved, Rejected` |
| **Customer plan redemption** ("customer withdrawal") | agent-initiated `src/app/api/transactions/redemption/request/route.ts`; customer-initiated `src/app/api/customer/redeem/route.ts`. Creates `EarlyRedemption` `status:'Pending'` (schema `prisma/schema.prisma:303-332`). | agent "forward" = `src/app/api/agent/redemption/[id]/route.ts` (→ `AgentApproved`); super admin `src/app/api/admin/early-redemption/[id]/route.ts` PATCH `approve` — for Bank Transfer, Paystack transfer (`:139-183`); for Cash, no Paystack (agent paid cash, wallet reimbursed). `reject` restores plan to Active (`:44-79`). | `Pending, TokenValidated, AgentApproved, AwaitingOTP, Finalizing, Processing, Approved, Rejected` |

Key facts the design leans on:

- **Funds are reserved at request time, not approval time.** So Manual mode
  changes *only* the approve/decline step and adds notifications — never the
  money-reservation logic.
- **All outbound Paystack calls live in one lib** (`src/lib/paystack.ts`:
  `createRecipient`, `initiateTransfer`, `finalizeTransfer`, `verifyTransfer`)
  and are invoked from exactly the two admin approve routes above.
- **A runtime key/value settings store already exists:** `PlatformSetting`
  (`prisma/schema.prisma:227-231`, JSON-encoded `value`). The commission-rates
  feature is the exact pattern to copy: read helper
  `src/lib/wallet-rates.ts:15-23`, admin read/write API
  `src/app/api/admin/commission/rates/route.ts` (`requireSuperAdmin` + `upsert`
  + `logAudit`). **No boolean flag table and no env toggle exist** — a new
  `PlatformSetting` key is the right home.
- **Email:** `sendMail({to,subject,html})` — `src/lib/mail.ts:3`, inline-HTML,
  logo via `emailLogo()` (`src/lib/email-brand.ts:3`). **`sendMail` has no
  NODE_ENV gate** — callers that must not send in dev gate themselves.
- **SMS (KudiSMS):** `sendSMS(to, body)` — `src/lib/kudisms.ts:3`,
  **self-gates to `NODE_ENV==='production'`** (returns success without sending
  otherwise).
- **Offline vs online customer is derived, not stored:** `customerType(plans)`
  (`src/lib/customer-type.ts:4-9`) → `'online'` if any plan `source==='self'`,
  else `'offline'`. Offline customers have no app/email → SMS is their channel.
- **Audit:** `logAudit(...)` (`src/lib/audit.ts`), already called on every
  approve/reject.

## Policy (owner-approved)

- **Two channels, independent toggles:** `agent` (commission payouts) and
  `customer` (plan redemptions). Each is `'auto'` or `'manual'`. Plus a
  one-click **"set everything to Manual" / "set everything to Automatic"**
  convenience in the UI.
- **Only the super admin** can read or change Payout Mode. Every change is
  audit-logged (who, old→new).
- **Default is `auto` for both channels** — until the admin flips a toggle,
  behaviour is byte-identical to today.
- **Notifications fire only in Manual mode.** Automatic mode sends none (no
  behaviour change at all).

## Mechanism (engineering decision)

### Storage + policy module

One `PlatformSetting` key `payoutMode`, JSON:
`{ "agent": "auto"|"manual", "customer": "auto"|"manual" }`.

A small module `src/lib/payout-mode.ts` (mirrors `wallet-rates.ts`):

```ts
export type PayoutChannel = 'agent' | 'customer'
export type PayoutMode = 'auto' | 'manual'
export const DEFAULT_PAYOUT_MODE: Record<PayoutChannel, PayoutMode>  // both 'auto'
export async function getPayoutMode(): Promise<Record<PayoutChannel, PayoutMode>>  // reads PlatformSetting, falls back to default, tolerates malformed JSON
export function parsePayoutMode(raw: string | null): Record<PayoutChannel, PayoutMode>  // pure, unit-tested
```

Admin API `src/app/api/admin/payout-mode/route.ts`: `GET` returns the current
modes; `POST` validates (`requireSuperAdmin`, each channel ∈ {auto,manual}),
`upsert`s the key, and `logAudit`s the change. Copy
`commission/rates/route.ts` almost verbatim.

### The Manual branch in the two approve routes

Both admin approve routes gain a mode check at the top of the `approve` action:
`const mode = (await getPayoutMode())[channel]`. When `mode === 'manual'`, the
route takes a **manual completion path** that produces the same local ledger
result as a successful Paystack payout **minus the Paystack calls**:

- **Agent withdrawal (`admin/agent-withdrawal/[id]/route.ts`):** claim
  `Pending → Approved` directly (same conditional `updateMany` guard), set
  `bankTransferStatus = 'manual'`, store the optional transfer reference in
  `adminNote`, set `decidedAt`/`decidedBy`, leave `paystackRecipientCode` /
  `paystackTransferCode` null. Commission was already debited at request, so no
  balance change. No PIN change (approve still requires the approval PIN).
- **Customer redemption (`admin/early-redemption/[id]/route.ts`):** for a
  **Bank Transfer** payout in Manual mode, skip the Paystack sub-block but keep
  the **plan lock** (`→ Redeemed`, balance 0) and the existing completion
  transaction (Revenue credit, agent commission credit, `Transaction` row),
  writing `bankTransferStatus = 'manual'` and null transfer codes. The agent
  wallet is **not** reimbursed (the admin pays the customer directly from the
  company bank — same as auto Bank Transfer, unlike the Cash path). The **Cash**
  payout path is unchanged (it never touched Paystack). The customer OTP-token
  confirmation and agent-approval steps are **unchanged** (they are security /
  workflow, not a payout rail).

This keeps Manual mode a *narrow* branch: same claims, same guards, same ledger
math, no Paystack. The rich in-flight states (`Processing`, `AwaitingOTP`,
`Finalizing`) are Paystack-only and simply don't occur in Manual mode.

### Notification chain (Manual mode only)

A new helper module `src/lib/payout-notify.ts` wraps `sendMail`/`sendSMS` with
the branded inline-HTML templates and the recipient channel-selection logic, so
the route handlers stay readable and each notification is unit-coverable where
pure. Each notification is **best-effort** — a failed email/SMS must never fail
or roll back the payout (wrap in try/catch + `console.error`, matching the
existing `swallow`/fire-and-forget pattern in the codebase). The money action is
the source of truth; the notification is a courtesy.

**Channel selection (owner-approved):**
- **Agent** recipient: email if `Agent.email` is set; **SMS fallback to the
  required `Agent.phone` when there is no email**. (`Agent.email` is optional,
  `phone` required — email-only would silently skip emailless agents.)
- **Customer** recipient: email for online customers; **SMS for offline
  customers** (type derived via `customerType(plans)`; offline customers have
  no email). An online customer with both may get email; offline is SMS.

**Reuse, don't duplicate — the agent-forward→super-admin email already exists.**
`src/lib/redemption-notify.ts` `notifySuperAdminsRedemptionPending` already
emails every `SuperAdmin` (table rows with a non-empty email) at the
agent-forward step, in **both** modes today. The feature must **not** add a
second admin notification there and must **not** suppress the existing one in
Auto (that would change Auto behaviour — anti-goal). So that step is "already
covered, reused as-is," not a new Manual-only send. This also resolves the
super-admin recipient-address question: it is the `SuperAdmin` table, already
implemented — no hardcoded address.

Notifications by step. "NEW (manual-only)" = this feature adds it, gated to
Manual mode; "existing" = already fires today in both modes, reused untouched:

| Step | Trigger (route) | Recipient(s) | Status |
|---|---|---|---|
| Agent requests payout | `agent/withdrawal/route.ts` POST | **Super admin** (SuperAdmin table) — email (amount, agent, bank/account) | NEW (manual-only) — the agent-withdrawal channel has no existing admin-notify helper |
| Admin pays agent | `admin/agent-withdrawal/[id]` approve | **Agent** — email-or-SMS "you've been paid" (amount, ref) | NEW (manual-only) |
| Admin declines agent | `admin/agent-withdrawal/[id]` reject | **Agent** — email-or-SMS with reason (funds refunded) | NEW (manual-only) |
| Customer redemption becomes agent-actionable | **`Pending → TokenValidated`** in `customer/redeem` PATCH (NOT request time) | **Agent** (the customer's agent) — email-or-SMS: review & forward | NEW (manual-only). Skipped when the agent is the requester (agent-initiated path) — see risk/ruling |
| Agent forwards redemption | `agent/redemption/[id]` (→AgentApproved) | **Super admin** — email | **Existing** (`redemption-notify.ts`, both modes) — reused, not duplicated |
| Admin pays customer | `admin/early-redemption/[id]` approve | **Agent** (email-or-SMS) + **Customer** (email if online, SMS if offline) | NEW (manual-only) |
| Agent or admin declines redemption | `agent/redemption/[id]` decline + `admin/early-redemption/[id]` reject | **Customer** (email/SMS) + agent | NEW (manual-only) |

**Timing correction (ruling):** the agent "review & forward" notification hooks
the `Pending → TokenValidated` transition, because the agent-forward route
*requires* `TokenValidated` — notifying at request time would send a
non-actionable email (the customer hasn't confirmed their OTP yet). In the
agent-initiated redemption path the agent is the requester, so this self-notify
is suppressed.

### UI

A new super-admin settings surface (match the existing admin settings pages,
e.g. `superadmin/commission`) with two labelled toggles (Agent payouts,
Customer redemptions), a prominent status banner when either channel is Manual,
and the "set all" buttons. In Manual mode, the existing withdrawal/redemption
admin pages (`superadmin/agent-withdrawals`, `superadmin/early-redemption`)
relabel the approve action to **"Mark as paid"** and show an optional
**transfer-reference** input; a banner reminds the admin that Paystack is
bypassed. No change to the agent or customer app UIs beyond what already exists
(the agent already has a forward/decline action).

## Scope

**In:** `payoutMode` `PlatformSetting` + `payout-mode.ts` policy module + admin
toggle API & UI; the Manual branch in the two admin approve/reject routes; the
`payout-notify.ts` helper and its wiring into the request / forward / approve /
decline steps; relabel + optional-reference input on the two admin payout pages;
tests for the pure policy parse and the notification-routing (offline→SMS)
logic.

**Out:** the parked commission-payout-to-agent accounting decision
(separate, see memory `commission-payout-decision-parked`); gift-card (no
agent/withdrawal system); changing fund-reservation timing; MFA/refresh tokens;
any Automatic-mode behaviour or notifications; a retry/queue that
auto-resumes Paystack when it recovers (admin flips back to Auto manually).

## Goals / non-goals / anti-goals

- **Goal:** the business can pay agents and customers during a Paystack outage,
  with a clear audit trail and everyone kept informed.
- **Non-goal:** auto-detecting Paystack health and flipping the switch — the
  admin decides and flips it.
- **Anti-goal:** any change that (a) alters Automatic-mode behaviour, (b)
  double-pays or fails to reserve funds, (c) lets a non-super-admin read or flip
  the mode, or (d) lets a notification failure roll back or block a real payout.

## Open calls settled by the author (flag for owner review)

1. **Optional transfer reference** on "Mark as paid," stored in `adminNote` and
   included in the recipient's "paid" message. (Minor; audit value.)
2. **Decline in Manual mode notifies** the waiting party with the reason, same
   infra as "paid." (In spirit of "notifications at important steps.")
3. **Manual Bank-Transfer redemption does the same ledger effects as an auto
   bank transfer** (plan locked, revenue + commission credited, Transaction
   row) minus Paystack, and does **not** reimburse the agent wallet (admin pays
   the customer directly). Cash path unchanged.
4. **In-flight payouts stuck in `Processing`/`AwaitingOTP`** from *before* the
   switch are handled by the existing `verify`/reconcile + OTP routes, not by
   this feature; Manual mode only governs *new* approvals.

### Resolved from builder-check (2026-11-01)

5. **Agent notification channel (owner-approved):** email if the agent has one,
   **SMS fallback to their phone when they don't** — agents have an optional
   email but a required phone, so email-only would silently skip some.
6. **Reuse the existing admin-notify helper.** `redemption-notify.ts` already
   emails super admins at the agent-forward step in both modes; the feature
   reuses it untouched and adds no duplicate (and never suppresses it in Auto).
   Resolves the super-admin-address question (= `SuperAdmin` table).
7. **Agent "review & forward" notification fires on `Pending → TokenValidated`,
   not at request time** (the forward route requires `TokenValidated`), and is
   suppressed when the agent is the requester. See the notification section.
8. **One shared completion `$transaction`** factored from the three existing
   duplicated completion sites, so the manual redemption ledger effect matches
   auto exactly minus Paystack. Top review-focus item (see Risks).

## Risks

- **Ledger divergence:** the manual redemption branch must reproduce the auto
  completion transaction exactly (minus Paystack). The auto completion effect is
  **duplicated across three sites** — the inline success branch in
  `early-redemption/[id]/route.ts`, `early-redemption/[id]/finalize-otp`, and
  `agent-withdrawal/[id]/verify` — and includes `interestPayoutOps` and the
  Revenue/commission credits. **Ruling / required planning step:** before
  writing the manual branch, read all three, identify the canonical completion
  effect, and factor it into one shared `$transaction` the manual path calls, so
  manual ≡ auto minus Paystack. This is the top review-focus item.
- **Mode read adds a query to the hot approve path:** one indexed
  `findUnique` on `PlatformSetting` — negligible, same as commission rates.
- **Notification noise / PII in logs:** templates must not log account numbers
  or tokens; best-effort sends must swallow errors.
- **`sendMail` not dev-gated:** the notify helper must gate non-prod sends (or
  rely on SMTP being unconfigured in dev) so testing doesn't email real people.
- **Toggle race:** mode is read at approve time; a flip mid-approval is
  resolved by whichever value the approve read — acceptable (admin-driven,
  low frequency).
