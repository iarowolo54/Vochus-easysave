# Payout Mode Switch (Automatic / Manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the super admin a per-channel Automatic/Manual payout switch so that, when Paystack transfers are down, agent commission payouts and customer plan redemptions can be approved by paying out-of-band and recording them as paid, with an email/SMS notification chain — while Automatic mode stays byte-identical to today.

**Architecture:** A `payoutMode` key in the existing `PlatformSetting` store, read through a pure, tested policy module. The two admin approve routes gain a Manual branch that skips Paystack and produces the same local ledger result (the redemption completion `$transaction` is first factored into one shared helper so Manual ≡ Auto minus Paystack). A best-effort `payout-notify.ts` helper sends the Manual-mode-only notifications, choosing email or SMS per recipient. A super-admin settings page toggles the modes; the two payout pages relabel "approve" to "Mark as paid" with an optional reference when their channel is Manual.

**Tech Stack:** Next.js 16.2.6 (App Router), Prisma + SQLite, next-auth 4.24.14, TypeScript. Email via `nodemailer` (`src/lib/mail.ts`), SMS via KudiSMS (`src/lib/kudisms.ts`). Tests: `NEXTAUTH_SECRET=test npx tsx --test tests/<file>`.

**Spec:** `docs/superpowers/specs/2026-11-01-payout-mode-switch-design.md`

## Global Constraints

- **Default is Automatic for both channels**, and Automatic mode must be **byte-identical to today**: no Paystack-path change, no new notifications. Every task is judged against this.
- **Mode values come only from `src/lib/payout-mode.ts`** — channels `'agent' | 'customer'`, modes `'auto' | 'manual'`; no inline string literals elsewhere.
- **Notifications are Manual-mode only and best-effort:** every `sendMail`/`sendSMS` call is wrapped so a failure logs and never throws, fails, or rolls back a payout. The money action is the source of truth.
- **Reuse, don't duplicate:** the agent-forward→super-admin email already exists (`src/lib/redemption-notify.ts`, fires in both modes) — do not add a second admin notification at that step and do not suppress it in Auto.
- **Preserve the atomic claim / fund-reservation logic** in both approve routes (conditional `updateMany` guards). Manual mode changes the *rail*, never the money-reservation or double-pay protections. Approve still requires the approval PIN.
- **Only the super admin** reads or changes the mode (`requireSuperAdmin` on both GET and POST). Every change is `logAudit`-ed (old → new).
- **No secrets/PII in logs or messages:** never log or email account numbers, tokens, OTPs. `sendMail` has no dev gate — real sends happen only when `NODE_ENV==='production'` (match `redemption-notify.ts`); `sendSMS` self-gates to prod.
- **No new `any`/`as any`.** `npx tsc --noEmit` is the type gate — **baseline is 23 errors; leave no new ones.** `next build` must pass.
- Gift-card is out of scope (no agent/withdrawal system). The accounting-only `admin/wallets/commission-payout` route is out of scope (never calls Paystack).

## Review Focus

- **Manual redemption ledger must equal Auto-minus-Paystack:** plan locked to `Redeemed`/0 exactly once, Revenue + agent commission + `interestPayoutOps` credited exactly once, the `Transaction` row written once, and the agent wallet **not** reimbursed for a Bank-Transfer payout (only Cash reimburses). No double-credit, no missing credit. → Task 5 (shared helper, no behaviour change) + Task 6 tests/review.
- **A missing or malformed `payoutMode` setting resolves to both `'auto'`** (never throws, never defaults a channel to manual). → Task 1 tests a null row and a garbage-JSON row.
- **A notification failure must not block or reverse a payout:** simulate `sendMail`/`sendSMS` throwing and assert the payout still completes. → Task 3 (helper swallows) + Task 4/6 wiring review.
- **Recipient channel selection:** an agent with no `email` is still notified **via SMS to their phone**; an **offline** customer is notified **via SMS**; an online customer via email. → Task 3 pure-function tests cover each.
- **Authorization:** both `GET` and `POST /api/admin/payout-mode` reject a non-super-admin (the agent and admin NextAuth configs share a secret — a bare session check is a known hole; require `role === 'superadmin'` via `requireSuperAdmin`). → Task 2 review.

---

### Task 1: `payout-mode.ts` — policy module + storage

**Files:**
- Create: `src/lib/payout-mode.ts`
- Test: `tests/payout-mode.test.ts`

**Interfaces:**
- Consumes: `prisma` (for `getPayoutMode`), `PlatformSetting` key `'payoutMode'`.
- Produces: `type PayoutChannel = 'agent' | 'customer'`; `type PayoutMode = 'auto' | 'manual'`; `const DEFAULT_PAYOUT_MODE: Record<PayoutChannel, PayoutMode>` (both `'auto'`); `function parsePayoutMode(raw: string | null): Record<PayoutChannel, PayoutMode>` (pure); `async function getPayoutMode(): Promise<Record<PayoutChannel, PayoutMode>>`.

- [ ] **Step 1: Write failing tests** (`tests/payout-mode.test.ts`) for `parsePayoutMode`:
  - `parsePayoutMode(null)` → `{ agent: 'auto', customer: 'auto' }`.
  - `parsePayoutMode('not json{')` → both `'auto'` (malformed tolerated).
  - `parsePayoutMode('{"agent":"manual","customer":"auto"}')` → `{ agent: 'manual', customer: 'auto' }`.
  - `parsePayoutMode('{"agent":"bogus"}')` → unknown/missing channel values fall back to `'auto'` (only `'manual'` flips a channel; everything else is `'auto'`).
- [ ] **Step 2: Run tests, verify they fail** (`NEXTAUTH_SECRET=test npx tsx --test tests/payout-mode.test.ts`).
- [ ] **Step 3: Implement.** `parsePayoutMode` JSON-parses in a try/catch, and for each channel returns `'manual'` only when the parsed value `=== 'manual'`, else `'auto'`. `getPayoutMode` reads `prisma.platformSetting.findUnique({ where: { key: 'payoutMode' } })` and returns `parsePayoutMode(setting?.value ?? null)`. Mirror the read pattern in `src/lib/wallet-rates.ts:15-23`.
- [ ] **Step 4: Run tests, verify pass; run the full suite.**
- [ ] **Step 5: Commit.**

### Task 2: Admin toggle API — `/api/admin/payout-mode`

**Files:**
- Create: `src/app/api/admin/payout-mode/route.ts`
- Test: none automated (route needs auth + DB) — document a manual check in the report.

**Interfaces:**
- Consumes: Task 1 (`PayoutChannel`, `PayoutMode`, `getPayoutMode`, `DEFAULT_PAYOUT_MODE`), `requireSuperAdmin` (`src/lib/admin-guard`), `logAudit` (`src/lib/audit`), `prisma`.
- Produces: `GET` → `{ mode: Record<PayoutChannel, PayoutMode> }`; `POST` body `{ mode: Record<PayoutChannel, PayoutMode> }` → `{ ok: true }`.

- [ ] **Step 1: Implement**, copying `src/app/api/admin/commission/rates/route.ts` almost verbatim:
  - `GET`: `requireSuperAdmin()`; return `{ mode: await getPayoutMode() }`.
  - `POST`: `requireSuperAdmin()`; read `{ mode }`; validate it is an object whose `agent` and `customer` are each exactly `'auto'` or `'manual'` (400 otherwise); `prisma.platformSetting.upsert({ where: { key: 'payoutMode' }, update: { value: JSON.stringify(mode) }, create: { key: 'payoutMode', value: JSON.stringify(mode) } })`; `logAudit({ action: 'payout_mode_updated', entity: 'PlatformSetting', details: 'agent <old>→<new>, customer <old>→<new>', actorType: 'admin', actorId, actorName })` (read the current mode before the upsert to log old→new).
- [ ] **Step 2:** `npx tsc --noEmit` (no new errors); run the full suite (should be unaffected).
- [ ] **Step 3: Manual check** (document in report): `GET` as super admin returns both `'auto'` on a fresh DB; `POST` `{agent:'manual',customer:'auto'}` persists and re-`GET` reflects it; `POST` with a bad value → 400; an audit row is written.
- [ ] **Step 4: Commit.**

### Task 3: `payout-notify.ts` — Manual-mode notification helper

**Files:**
- Create: `src/lib/payout-notify.ts`
- Test: `tests/payout-notify.test.ts` (pure channel-selection only)

**Interfaces:**
- Consumes: `sendMail` (`src/lib/mail.ts`), `sendSMS` (`src/lib/kudisms.ts`), `emailLogo` (`src/lib/email-brand.ts`), `customerType` (`src/lib/customer-type.ts`), `formatNaira` (`src/lib/format`).
- Produces (pure, exported for test):
  - `function agentNotifyChannel(agent: { email: string | null; phone: string }): { via: 'email'; to: string } | { via: 'sms'; to: string }` — `email` when `agent.email` is a non-empty string, else `sms` to `agent.phone`.
  - `function customerNotifyChannel(customer: { email: string | null; phone: string }, type: CustomerType): { via: 'email'; to: string } | { via: 'sms'; to: string }` — `offline` → `sms`; `online` → `email` when email non-empty else `sms`.
- Produces (best-effort senders, each wrapped so they never throw; email bodies use `emailLogo()` + inline HTML, SMS bodies are short plain text; **no account numbers/tokens in any body**):
  - `notifySuperAdminsAgentWithdrawal(input: { agentName: string; amountNaira: number; ref: string })` — emails every `SuperAdmin` with a non-empty email (same lookup as `redemption-notify.ts`).
  - `notifyAgentPayoutPaid(agent, input: { amountNaira; ref })` / `notifyAgentPayoutDeclined(agent, input: { amountNaira; ref; reason })` — via `agentNotifyChannel`.
  - `notifyAgentRedemptionToReview(agent, input: { customerName; amountNaira; ref })` — via `agentNotifyChannel`.
  - `notifyAgentRedemptionPaid(agent, input: { customerName; amountNaira; ref })` / `notifyAgentRedemptionDeclined(agent, input: { customerName; amountNaira; ref; reason })` — via `agentNotifyChannel` (the agent learns their customer was/ wasn't paid).
  - `notifyCustomerRedemptionPaid(customer, type, input: { amountNaira; ref })` / `notifyCustomerRedemptionDeclined(customer, type, input: { amountNaira; ref; reason })` — via `customerNotifyChannel`.

- [ ] **Step 1: Write failing tests** (`tests/payout-notify.test.ts`) for the two pure functions:
  - `agentNotifyChannel({ email: 'a@b.co', phone: '080...' })` → `{ via: 'email', to: 'a@b.co' }`.
  - `agentNotifyChannel({ email: null, phone: '080...' })` and `({ email: '', phone })` → `{ via: 'sms', to: '080...' }`.
  - `customerNotifyChannel({ email: 'c@d.co', phone }, 'online')` → email; `customerNotifyChannel({ email: null, phone }, 'online')` → sms; `customerNotifyChannel({ email: 'c@d.co', phone }, 'offline')` → sms.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement** the pure functions and the senders. Each sender: build the message, dispatch via the chosen channel, wrap the whole body in `try/catch` (log `console.error`, never rethrow). The `SuperAdmin` lookup matches `redemption-notify.ts:23-26`. Do not gate inside the helper beyond what `sendMail`/`sendSMS` already do (sendSMS self-gates; for `sendMail` rely on SMTP being unset off-prod, as `redemption-notify.ts` does — i.e. gate the admin-email send on `NODE_ENV==='production'` to match it).
- [ ] **Step 4: Run tests, verify pass; full suite; `npx tsc --noEmit`.**
- [ ] **Step 5: Commit.**

### Task 4: Agent payout — Manual branch + notifications

**Files:**
- Modify: `src/app/api/admin/agent-withdrawal/[id]/route.ts`, `src/app/api/agent/withdrawal/route.ts`
- Test: none automated — document manual checks.

**Interfaces:**
- Consumes: Task 1 `getPayoutMode`, Task 3 senders.

- [ ] **Step 1: Implement the Manual approve branch** in `admin/agent-withdrawal/[id]/route.ts`. At the top of the `approve` action read `const manual = (await getPayoutMode()).agent === 'manual'`. When `manual`:
  - Skip the entire Paystack block (`createRecipient`/`initiateTransfer`, OTP, releaseClaim).
  - Claim `Pending → Approved` with one conditional `updateMany` (`where: { id, status: 'Pending' }`), setting `decidedAt`, `decidedBy`, `adminNote` (the optional transfer reference from the request body), `bankTransferStatus: 'manual'`, leaving `paystackRecipientCode`/`paystackTransferCode` null. `count === 0` → 409. Commission was already debited at request — no balance change.
  - `logAudit` the manual approval (note `manual payout`).
  - After the DB write, fire `notifyAgentPayoutPaid(agent, { amountNaira: record.amount, ref: record.ref })` (best-effort).
  - The Automatic path is unchanged.
- [ ] **Step 2: Add the decline notification.** In the existing `reject` action, after the refund succeeds, fire `notifyAgentPayoutDeclined(...)` **only when `(await getPayoutMode()).agent === 'manual'`** (keeps Auto silent). Reuse `adminNote` as the reason.
- [ ] **Step 3: Add the request-time admin notification.** In `agent/withdrawal/route.ts` POST, after the withdrawal is created, if `(await getPayoutMode()).agent === 'manual'` fire `notifySuperAdminsAgentWithdrawal({ agentName, amountNaira, ref })` (best-effort). Do not alter the debit/create logic.
- [ ] **Step 4:** `npx tsc --noEmit` (no new errors); `next build`; full suite.
- [ ] **Step 5: Manual check** (report): with mode `agent:'manual'`, approving a pending agent withdrawal sets it `Approved` with `bankTransferStatus:'manual'` and makes **no** Paystack call; with mode `agent:'auto'` the Paystack path is unchanged. Confirm a forced `sendMail` throw does not fail the approve.
- [ ] **Step 6: Commit.**

### Task 5: Factor redemption completion into one shared helper (no behaviour change)

**Files:**
- Create: `src/lib/redemption-complete.ts`
- Modify: `src/app/api/admin/early-redemption/[id]/route.ts` (call the helper from the existing success branch)
- Test: none new — the gate is "all existing tests stay green + tsc + build", because this task changes no behaviour.

**Interfaces:**
- Produces: `function redemptionCompletionOps(tx, record, agentId, customerId, opts: { isBankTransfer: boolean; bankTransferStatus: string | null; paystackRecipientCode: string | null; paystackTransferCode: string | null; claimFrom: 'Processing' | string[] })` — returns/performs the ops currently inline at `early-redemption/[id]/route.ts:195-247` (claim `→ Approved`, plan lock when not bank-transfer-preclaimed, Revenue credit, agent commission + conditional wallet reimbursement, `Transaction` row, `interestPayoutOps`). Keep the `ConflictError` semantics.

- [ ] **Step 1: Read all three existing completion sites** — the inline success branch (`early-redemption/[id]/route.ts:195-247`), `early-redemption/[id]/finalize-otp/route.ts`, `agent-withdrawal/[id]/verify/route.ts` — and confirm the exact completion effect for the redemption (Revenue, commission, wallet reimbursement rule, `Transaction`, `interestPayoutOps`). Record in the report which effects are canonical. (Only the redemption completion is factored here; the agent-withdrawal verify path is read for parity, not changed.)
- [ ] **Step 2: Extract** `redemptionCompletionOps` capturing exactly today's inline behaviour, and call it from the inline success branch so the route's observable behaviour is **unchanged**.
- [ ] **Step 3: Verify no behaviour change** — full suite green, `npx tsc --noEmit` (no new errors), `next build` passes. (Pure refactor; if any test changes output, the extraction is wrong.)
- [ ] **Step 4: Commit.**

### Task 6: Customer redemption — Manual branch + notifications

**Files:**
- Modify: `src/app/api/admin/early-redemption/[id]/route.ts`, `src/app/api/customer/redeem/route.ts`, `src/app/api/agent/redemption/[id]/route.ts`
- Test: none automated — document manual checks.

**Interfaces:**
- Consumes: Task 1 `getPayoutMode`, Task 3 senders, Task 5 `redemptionCompletionOps`, `customerType`.

- [ ] **Step 1: Manual approve branch** in `admin/early-redemption/[id]/route.ts`. At the top of `approve` read `const manual = (await getPayoutMode()).customer === 'manual'`. When `manual` **and** the payout is Bank Transfer: skip the Paystack sub-block (`:98-184`) entirely and instead run `redemptionCompletionOps` with `claimFrom: OPEN_STATUSES`, `bankTransferStatus: 'manual'`, null transfer codes (this locks the plan and credits exactly as Auto would, minus Paystack; agent wallet **not** reimbursed because `isBankTransfer` is true). Preserve the already-redeemed guard (`:84-86`). The Cash path and the Automatic path are unchanged.
- [ ] **Step 2: Paid + declined notifications** (customer channel). Compute the customer's type via `customerType(plans)` (load the customer's plans' `source`). After a manual approve completes, fire `notifyCustomerRedemptionPaid(customer, type, …)` **and** `notifyAgentRedemptionPaid(agent, …)`. In the admin `reject` action, when `customer:'manual'`, fire `notifyCustomerRedemptionDeclined(...)` **and** `notifyAgentRedemptionDeclined(...)`. All best-effort.
- [ ] **Step 3: Agent "review & forward" notification.** In `customer/redeem/route.ts` PATCH, at the `Pending → TokenValidated` transition (`:176-179`), if `(await getPayoutMode()).customer === 'manual'` fire `notifyAgentRedemptionToReview(agent, …)` to the customer's agent (look up the agent from the plan's customer). This is the actionable moment (the agent GET lists `TokenValidated`). **Verify the agent-initiated request path (`transactions/redemption/request`) does not need this notification** (the agent is the requester there) and record the finding; do not add a self-notify.
- [ ] **Step 4: Agent-decline notification.** In `agent/redemption/[id]/route.ts` `reject`, if `(await getPayoutMode()).customer === 'manual'` fire `notifyCustomerRedemptionDeclined(customer, type, { reason })`. Leave the existing `notifySuperAdminsRedemptionPending` on the approve path untouched (it already fires in both modes — do not duplicate).
- [ ] **Step 5:** `npx tsc --noEmit` (no new errors); `next build`; full suite.
- [ ] **Step 6: Manual check** (report): with `customer:'manual'`, approving a Bank-Transfer redemption makes **no** Paystack call, locks the plan to Redeemed/0, credits Revenue + commission once, writes one `Transaction`, and does **not** reimburse the agent wallet; a Cash redemption behaves as before; with `customer:'auto'` the Paystack path is unchanged. Confirm a forced notify throw does not fail the approve.
- [ ] **Step 7: Commit.**

### Task 7: Super admin UI — toggle page + payout-page relabel

**Files:**
- Create: `src/app/superadmin/payout-mode/page.tsx`
- Modify: `src/app/superadmin/agent-withdrawals/page.tsx`, `src/app/superadmin/early-redemption/page.tsx`, and the super-admin nav (find the menu that links `superadmin/commission` and add a "Payout Mode" entry)
- Test: none automated (UI) — document a manual check.

**Interfaces:**
- Consumes: `GET`/`POST /api/admin/payout-mode` (Task 2).

- [ ] **Step 1: Build the toggle page**, matching the style of an existing admin settings page (e.g. `superadmin/commission/page.tsx`): load `GET /api/admin/payout-mode`; render two labelled toggles (**Agent payouts**, **Customer redemptions**) each Auto/Manual; a prominent banner when either is Manual ("Paystack is bypassed — you pay out-of-band"); "Set everything to Manual" / "Set everything to Automatic" buttons; `POST` the new mode and reflect the result. Handle loading/empty/error states (`frontend.md`). Add the nav entry.
- [ ] **Step 2: Relabel the two payout pages when their channel is Manual.** On `agent-withdrawals` and `early-redemption` pages, fetch the mode; when the page's channel is Manual, relabel the approve action to **"Mark as paid"**, show an optional **transfer-reference** text input whose value is sent as `adminNote` on approve, and show a banner that Paystack is bypassed. When Auto, the pages are unchanged. Must work at ~360px (WebView).
- [ ] **Step 3:** `npx tsc --noEmit` (no new errors); `next build`.
- [ ] **Step 4: Manual check** (report): toggling on the new page persists and the payout pages switch their label/branch; the reference input flows into the recorded `adminNote`.
- [ ] **Step 5: Commit.**
