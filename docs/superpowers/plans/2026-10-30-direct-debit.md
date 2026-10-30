# Direct Debit (Paystack auto-funding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an online saver opt in to having Paystack automatically debit their committed contribution on schedule, crediting their savings plan with no manual step, safely and idempotently.

**Architecture:** A new `AutoDebitMandate` (one per plan) stores a reusable Paystack card authorization; a new `AutoDebitAttempt` records each cycle's charge. The existing daily cron fires due debits (grossed up so the plan still gets the full contribution) and reconciles any that stayed `processing`; the existing Paystack webhook and the cron sweep funnel through one idempotent credit path. Backend only — the customer-app enrollment/cancel screen is built separately by the UI side against the API contract below.

**Tech Stack:** Next.js App Router route handlers, Prisma + SQLite, `node:crypto`, the shared `src/lib/paystack.ts` client, `money()` from `src/lib/wallet-guard.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-direct-debit-design.md`

## Global Constraints

- Online plans only: a mandate exists only for `SavingsPlan.source === 'self'`.
- Money is `Float`; round every naira value with `money()` from `@/lib/wallet-guard`. Convert to integer kobo only at the Paystack boundary with `Math.round(x * 100)`.
- Server-side authorization only (customer from `getCustomerSession()`, `@/lib/customer-auth`); every plan/mandate lookup scoped to the owning customer, 404 otherwise.
- Idempotency key is the deterministic `reference = autodebit-{planId}-{yyyymmdd}`, unique on both `Transaction.ref` and `AutoDebitAttempt.reference`. Credit at most once per plan per scheduled day.
- `authorizationCode` is a secret: never returned in any response, logged, or put in a JWT; never `select`ed into list endpoints. Never store PAN/CVV/PIN/OTP.
- No new `any`/`as any`; keep `npx tsc --noEmit` at its 23-error baseline. `@ts-expect-error <reason>` only if unavoidable.
- No secret env fallbacks; fail closed. Fee-bearer = customer (gross up). Auto-debit stops at `maturityDate`.
- Migrations are forward-only, one per schema change, per `docs/migration-baseline.md`; never `migrate reset`/`db push --accept-data-loss` against real data.
- Tests run with `NEXTAUTH_SECRET=test npx tsx --test tests/<file>`; Paystack calls must NOT hit the network in tests (use the `isTestMode()` short-circuit for `sk_test_` keys, or mock `global.fetch`). node:test runs files as parallel processes against one dev.db — scope every test's data by a unique run id and clean up only your own rows (no table-wide `deleteMany({})`).

## Review Focus

- **Replayed webhook / double sweep** for the same `reference` must credit exactly once (unique ref + pre-check). → Task 6.
- **Charge returns `processing` and no webhook ever arrives** → the reconciliation sweep must still settle or fail-and-count it. → Task 11.
- **Fee gross-up crossing the ₦2,500 flat-fee band** must still leave net ≥ the contribution (piecewise inverse, not a single formula). → Task 2.
- **A plan at/after `maturityDate`, or no longer `Active`,** must never be debited (bounds total to the committed term). → Tasks 4 & 11.
- **An expired/invalid card** must pause the mandate immediately (no endless retries draining the customer); insufficient-funds retries up to N then pause. → Task 7.

---

### Task 1: Schema — `AutoDebitMandate` + `AutoDebitAttempt` + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_auto_debit/migration.sql`
- Test: `tests/auto-debit-schema.int.test.ts`

**Interfaces:**
- Produces: Prisma models `AutoDebitMandate` and `AutoDebitAttempt` exactly as in the spec's "Data model" section (fields, types, defaults, `@unique` on `AutoDebitMandate.savingsPlanId` and `AutoDebitAttempt.reference`). Client accessors `prisma.autoDebitMandate` / `prisma.autoDebitAttempt`.

- [ ] **Step 1: Write the failing test** — `tests/auto-debit-schema.int.test.ts`: create a `Customer`+`Agent`+`SavingsPlan`, then `prisma.autoDebitMandate.create` (status default `pending`) and `prisma.autoDebitAttempt.create` (status default `pending`); assert the rows read back with defaults, and that a second `autoDebitAttempt.create` with the same `reference` rejects (`P2002`). Clean up by ids.
- [ ] **Step 2: Run it, verify it fails** — `NEXTAUTH_SECRET=test npx tsx --test tests/auto-debit-schema.int.test.ts` → FAIL (`prisma.autoDebitMandate` undefined).
- [ ] **Step 3: Add both models** to `prisma/schema.prisma` per the spec; run `npx prisma migrate dev --name add_auto_debit` (additive `RedefineTables`, data-safe), then `npx prisma generate`. Commit the generated `migration.sql`.
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(direct-debit): AutoDebitMandate + AutoDebitAttempt schema + migration`.

---

### Task 2: Fee gross-up calculator (pure)

**Files:**
- Create: `src/lib/auto-debit-fee.ts`
- Test: `tests/auto-debit-fee.test.ts`

**Interfaces:**
- Produces:
  - `paystackFee(amountNaira: number): number` — Paystack NGN fee: `1.5%` of amount; add `₦100` only when `amount >= 2500`; cap the whole fee at `₦2000`; `money()`-rounded.
  - `grossUpForFee(creditNaira: number): { grossCharged: number; feeEstimate: number }` — smallest `money()` naira amount to charge so that `grossCharged - paystackFee(grossCharged) >= creditNaira`, with `feeEstimate = paystackFee(grossCharged)`.

- [ ] **Step 1: Write the failing test** — assertions:
  - `paystackFee(100) === 1.5`; `paystackFee(1000) === 15`; `paystackFee(2500) === 137.5`; `paystackFee(200000) === 2000` (cap).
  - `grossUpForFee(1000)` → `grossCharged === 1015.23`, and `money(grossCharged - feeEstimate) >= 1000`.
  - Band-crossing: `grossUpForFee(2490)` → `money(grossCharged - paystackFee(grossCharged)) >= 2490` (the gross crosses 2500, so the ₦100 flat applies and the net still covers the credit).
  - `grossUpForFee(100)` → net `>= 100`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Algorithm for `grossUpForFee` (piecewise inverse — not determined by the signature): compute a candidate in the no-flat band `g = money(credit / (1 - 0.015))`; if `g >= 2500`, recompute `g = money((credit + 100) / (1 - 0.015))`; then while `money(g - paystackFee(g)) < credit`, add `0.01`. Return `money()` values.
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(direct-debit): Paystack fee gross-up calculator`.

---

### Task 3: Paystack client — authorization init, charge, verify

**Files:**
- Modify: `src/lib/paystack.ts`
- Test: `tests/paystack-charge.test.ts`

**Interfaces:**
- Consumes: the private `call(method, path, body)` and `isTestMode()` already in the file.
- Produces:
  - `initCardAuthorization(input: { email: string; amountNaira: number; reference: string; metadata: object; callbackUrl?: string }): Promise<{ authorizationUrl: string; reference: string }>` — `POST /transaction/initialize` with `amount` in kobo, `channels: ['card']`.
  - `chargeAuthorization(input: { authorizationCode: string; email: string; amountNaira: number; reference: string; metadata?: object }): Promise<{ status: string; reference: string; gatewayResponse?: string; raw: unknown }>` — `POST /transaction/charge_authorization`, `currency: 'NGN'` explicit, `amount` in kobo. In `isTestMode()` return a deterministic `{ status: 'success', reference, gatewayResponse: 'Approved' }`.
  - `verifyTransaction(reference: string): Promise<{ status: string; amountNaira: number; currency: string; channel?: string; authorization?: PaystackAuthorization; gatewayResponse?: string; raw: unknown }>` — `GET /transaction/verify/:reference`. In `isTestMode()` return a deterministic success for a `autodebit-`/`VCHS-` ref.
  - `export interface PaystackAuthorization { authorization_code: string; signature: string; reusable: boolean; last4?: string; card_type?: string; bank?: string; exp_month?: string; exp_year?: string; channel?: string }`

- [ ] **Step 1: Write the failing test** — with a `sk_test_` key: `chargeAuthorization` returns `status:'success'` and echoes the `reference`; `verifyTransaction('autodebit-x-20261030')` returns `status:'success'`. With `global.fetch` stubbed (non-test key): assert `chargeAuthorization` POSTs to `/transaction/charge_authorization` with body `amount === Math.round(amountNaira*100)` and `currency === 'NGN'`. Restore `fetch` after.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the three functions + the interface, mirroring the existing `initiateTransfer`/`verifyTransfer` style (test-mode short-circuit, `data.status` check, `money()` on naira out).
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(direct-debit): Paystack charge_authorization + verify + auth init`.

---

### Task 4: Scheduling — cadence, next run, per-cycle amount, termination (pure)

**Files:**
- Create: `src/lib/auto-debit-schedule.ts`
- Test: `tests/auto-debit-schedule.test.ts`

**Interfaces:**
- Produces:
  - `autoDebitCadence(planCadence: string): 'weekly' | 'monthly'` — `daily`→`weekly`, `weekly`→`weekly`, `monthly`→`monthly` (D7).
  - `nextRunAt(from: Date, cadence: 'weekly' | 'monthly'): Date` — next boundary strictly after `from` (+7 days, or +1 month month-end-clamped like accrual's `addMonthsClamped`).
  - `cycleCreditAmount(plan: { dailyAmount: number; cadence: string; maturityDate: Date }, cycleDate: Date): number` — `0` if `cycleDate >= maturityDate`; for a `daily` plan: `money(dailyAmount * daysThisBatch)` where `daysThisBatch = min(7, whole days from cycleDate to maturityDate)` (pro-rated final batch, D8); for `weekly`/`monthly`: `money(dailyAmount)`.

- [ ] **Step 1: Write the failing test** — assertions (use fixed UTC dates):
  - `autoDebitCadence('daily') === 'weekly'`, `autoDebitCadence('monthly') === 'monthly'`.
  - `nextRunAt(Jan 1, 'weekly')` = Jan 8; `nextRunAt(Jan 31, 'monthly')` = Feb 28 (clamp).
  - daily plan, `dailyAmount 100`, maturity far off, `cycleCreditAmount` = `700`; with maturity only 3 days after `cycleDate` → `300`; `cycleDate` on/after maturity → `0`.
  - weekly plan `dailyAmount 1000` → `cycleCreditAmount === 1000`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Reuse the month-end-clamp approach from `src/lib/savings-interest.ts` (copy the small helper or import if exported; do not change interest code).
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(direct-debit): auto-debit scheduling + termination math`.

---

### Task 5: Mandate lifecycle helpers

**Files:**
- Create: `src/lib/auto-debit.ts`
- Test: `tests/auto-debit-mandate.int.test.ts`

**Interfaces:**
- Consumes: `autoDebitCadence`, `nextRunAt` (Task 4); `PaystackAuthorization` (Task 3).
- Produces:
  - `createMandateFromAuthorization(client, input: { customerId: string; plan: { id: string; source: string; cadence: string; dailyAmount: number }; email: string; authorization: PaystackAuthorization }): Promise<{ id: string } | { error: 'not_self' | 'not_reusable' | 'exists' }>` — refuses non-`self` plans, non-`reusable` cards, or a plan that already has a mandate; stores masked display fields + `authorizationCode`/`authSignature`/`authEmail`, `status:'active'`, `amountPerCycle = dailyAmount`, `nextRunAt`, `consentAt`.
  - `dueMandates(client, now: Date): Promise<MandateWithPlan[]>` — `status:'active'`, `nextRunAt <= now`, plan still `Active` and `maturityDate > now`.
  - `pauseMandate(client, mandateId: string): Promise<void>`; `cancelMandate(client, mandateId: string): Promise<void>` (sets `cancelled`; Paystack `deactivate` call is done by the route, Task 10).

- [ ] **Step 1: Write the failing test** — `createMandateFromAuthorization` on a `self` plan with `reusable:true` creates an `active` mandate with masked fields and no raw PAN; on an `agent` plan → `{ error: 'not_self' }`; on `reusable:false` → `{ error: 'not_reusable' }`; a second call for the same plan → `{ error: 'exists' }`. `dueMandates` returns only active, due, pre-maturity mandates of Active plans. Scope rows by run id.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): mandate lifecycle helpers`.

---

### Task 6: Idempotent credit path (shared by webhook + sweep)

**Files:**
- Create: `src/lib/auto-debit-credit.ts`
- Test: `tests/auto-debit-credit.int.test.ts`

**Interfaces:**
- Produces: `creditAutoDebitAttempt(client, input: { reference: string; settledAmountNaira: number }): Promise<'credited' | 'already' | 'not_found'>` — looks up the `AutoDebitAttempt` by `reference`; if already `success` → `already`; else in ONE `prisma.$transaction`: create a `saving` `Transaction` (`ref = reference`, `amount = attempt.creditAmount`, `status:'Done'`, `method:'Paystack'`, `agentId = plan.customer.agentId`, `customerId`, `planId`), `increment` plan `balance` by `creditAmount`, set attempt `status:'success'` + `settledAmount`, reset mandate `consecutiveFailures = 0`, `logAudit`. Unique `Transaction.ref` makes a concurrent/replayed call return `already`.

- [ ] **Step 1: Write the failing test** — seed a mandate + a `processing` attempt (`creditAmount 700`); `creditAutoDebitAttempt({reference, settledAmountNaira: 710})` → `'credited'`, plan balance +700, one `saving` Transaction with `ref===reference`, attempt `success`, `settledAmount 710`; a second identical call → `'already'`, balance unchanged, still one Transaction. Unknown ref → `'not_found'`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): idempotent auto-debit credit path`.

---

### Task 7: Failure / retry / pause path

**Files:**
- Create: `src/lib/auto-debit-failure.ts`
- Test: `tests/auto-debit-failure.int.test.ts`

**Interfaces:**
- Consumes: `pauseMandate` (Task 5).
- Produces:
  - `export const MAX_CONSECUTIVE_FAILURES = 3`
  - `recordAutoDebitFailure(client, input: { reference: string; gatewayResponse: string }): Promise<{ paused: boolean }>` — sets the attempt `status:'failed'` + `gatewayResponse`, increments mandate `consecutiveFailures`; if the response matches an unrecoverable card error (`/expired|invalid|do not honour|blacklisted/i`) → pause immediately; else pause when `consecutiveFailures >= MAX_CONSECUTIVE_FAILURES`. Returns whether it paused. Idempotent on an already-`failed` attempt (no double increment).

- [ ] **Step 1: Write the failing test** — one insufficient-funds failure → `consecutiveFailures 1`, not paused; three → paused; a single `"Expired card"` failure → paused immediately; re-calling for an already-`failed` reference does not increment again.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): auto-debit failure/retry/pause`.

---

### Task 8: Enrollment init route

**Files:**
- Create: `src/app/api/customer/auto-debit/init/route.ts`
- Test: `tests/auto-debit-init.int.test.ts`

**Interfaces:**
- Consumes: `getCustomerSession`; `initCardAuthorization` (Task 3); `createPaymentIntent` (`@/lib/payment-intent`); `grossUpForFee` (Task 2).
- Produces: `POST /api/customer/auto-debit/init` body `{ planId: string }` → `200 { authorizationUrl, reference }`. Validates the plan is the customer's, `Active`, `source:'self'`, with no existing active mandate (else `400`/`409`). Uses a first-charge of `₦50` (applied to the plan on success), records a `PaymentIntent` (actorType `customer`, the `reference`, amount 50, planId) and a marker that this reference is an auto-debit enrollment (e.g. `reference` prefix `autodebit-enroll-{planId}-{rand}`). Returns `401` before any work.

- [ ] **Step 1: Write the failing test** — using a `sk_test_` key: a `self` Active plan → `200` with an `authorizationUrl` and a `reference`, and a pending `PaymentIntent` exists for it; an `agent` plan → `400`; no session → `401`; a plan with an existing active mandate → `409`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): enrollment init route`.

---

### Task 9: Enrollment verify route (store mandate + credit first charge)

**Files:**
- Create: `src/app/api/customer/auto-debit/verify/route.ts`
- Test: `tests/auto-debit-verify.int.test.ts`

**Interfaces:**
- Consumes: `getCustomerSession`; `verifyTransaction` (Task 3); `findOwnedPendingIntent`/`consumePaymentIntent` (`@/lib/payment-intent`); `createMandateFromAuthorization` (Task 5); `creditAutoDebitAttempt` or a direct ₦50 credit.
- Produces: `POST /api/customer/auto-debit/verify` body `{ reference: string }` → on a verified-success enrollment reference owned by this customer: store the mandate from `authorization` (refuse non-`reusable` → `400`), credit the ₦50 first charge to the plan (one `saving` Transaction, idempotent on the ref), return `200 { active: true }`. Rejects a reference with no owned pending intent (`403`), a non-success verify (`400`). Never returns the `authorizationCode`.

- [ ] **Step 1: Write the failing test** — test-mode verify success + a pending enrollment intent → mandate row `active`, ₦50 credited once, `200 { active:true }`, and the JSON body contains no `authorizationCode`; replay → idempotent (still one credit); foreign/unknown reference → `403`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): enrollment verify + mandate store`.

---

### Task 10: Status + cancel routes

**Files:**
- Create: `src/app/api/customer/auto-debit/route.ts` (GET status), `src/app/api/customer/auto-debit/cancel/route.ts` (POST)
- Test: `tests/auto-debit-cancel.int.test.ts`

**Interfaces:**
- Consumes: `cancelMandate` (Task 5); a Paystack `deactivateAuthorization(authorizationCode)` helper (add a thin one to `src/lib/paystack.ts`, test-mode no-op, `POST /customer/authorization/deactivate`).
- Produces:
  - `GET /api/customer/auto-debit?planId=` → `200 { status, amountPerCycle, nextRunAt, last4, bankName }` for the owned plan's mandate, or `{ status: 'none' }`. Never the `authorizationCode`.
  - `POST /api/customer/auto-debit/cancel` body `{ planId }` → sets the mandate `cancelled`, calls Paystack deactivate, `200 { status:'cancelled' }`. `401`/`404` as appropriate.

- [ ] **Step 1: Write the failing test** — enrolled plan GET → masked status (no secret); cancel → mandate `cancelled` and GET then shows `cancelled`; foreign plan → `404`; no session → `401`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): auto-debit status + cancel routes`.

---

### Task 11: Cron — fire due debits + reconciliation sweep

**Files:**
- Modify: `src/app/api/cron/daily/route.ts`
- Create: `src/lib/auto-debit-run.ts` (the two pass functions, so they're unit/int-testable without HTTP auth)
- Test: `tests/auto-debit-cron.int.test.ts`

**Interfaces:**
- Consumes: `dueMandates` (5), `cycleCreditAmount`/`nextRunAt` (4), `grossUpForFee` (2), `chargeAuthorization`/`verifyTransaction` (3), `creditAutoDebitAttempt` (6), `recordAutoDebitFailure` (7).
- Produces:
  - `runDueAutoDebits(client, now: Date): Promise<{ charged: number; skipped: number; failed: number }>` — for each `dueMandates`: compute `creditAmount = cycleCreditAmount(...)` (skip if `0`), `grossUpForFee`, build `reference = autodebit-{planId}-{yyyymmdd}`, skip if a `Transaction` or `AutoDebitAttempt` with that ref exists, else create a `processing` `AutoDebitAttempt`, call `chargeAuthorization`; on test-mode/`success` route through `creditAutoDebitAttempt`; advance `mandate.nextRunAt`. Per-mandate try/catch; one failure never halts the batch.
  - `reconcileProcessingAttempts(client, now: Date, olderThanMs?: number): Promise<{ settled: number; failed: number }>` — for attempts still `processing` older than the threshold (default 2h), `verifyTransaction`; success → `creditAutoDebitAttempt`; failed → `recordAutoDebitFailure`.
  - The `GET` handler calls both after the interest pass and folds counts into the JSON report.

- [ ] **Step 1: Write the failing test** (test-mode Paystack): seed an active mandate due now on a `self` plan → `runDueAutoDebits` charges once, plan balance += the cycle amount, one `success` attempt; running it again the same day charges nothing (idempotent). A `processing` attempt with no credit → `reconcileProcessingAttempts` settles it exactly once. A due mandate whose plan is past maturity → skipped, balance unchanged.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): cron due-debit + reconciliation passes`.

---

### Task 12: Webhook — credit auto-debit `charge.success`

**Files:**
- Modify: `src/app/api/paystack/webhook/route.ts`
- Test: `tests/auto-debit-webhook.int.test.ts`

**Interfaces:**
- Consumes: `verifyTransaction` (3), `creditAutoDebitAttempt` (6), `recordAutoDebitFailure` (7).
- Produces: in the existing (signature-verified) handler, handle `charge.success` whose `data.reference` starts with `autodebit-`: re-verify via `verifyTransaction`, confirm success + amount/currency match the attempt, then `creditAutoDebitAttempt`. (A documented note at the top: confirm Paystack is configured to POST this handler, not `api/webhooks/paystack`.)

- [ ] **Step 1: Write the failing test** — POST a `charge.success` body with a valid HMAC-SHA512 signature (`PAYSTACK_WEBHOOK_SECRET` set in the test) and an `autodebit-` reference for a seeded `processing` attempt → `200`, attempt `success`, plan credited once; a replay → still one credit; a body with a bad signature → `401` and no credit.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): webhook credits auto-debit charges`.

---

### Task 13: Pause/failure notification (minimal)

**Files:**
- Modify: `src/lib/auto-debit-failure.ts` (fire a notification when it pauses)
- Test: extend `tests/auto-debit-failure.int.test.ts`

**Interfaces:**
- Consumes: the existing email/SMS senders (locate with `grep -rn "kudisms\|sendEmail\|sendSms" src/lib`); send email if the customer has one, else SMS, matching the Feature 3 channel rule. Guard so it never throws into the caller (`.catch`), and only actually sends under `NODE_ENV==='production'` (the senders already enforce this — confirm).
- Produces: when `recordAutoDebitFailure` pauses a mandate, it notifies the customer that auto-debit is paused and how to re-enable. No secret/code in the message.

- [ ] **Step 1: Write the failing test** — stub the sender module; assert it's called once with the customer's email (or SMS when no email) only when the mandate pauses, not on a non-pausing failure.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(direct-debit): notify customer when auto-debit pauses`.

---

## API contract for the UI side (hand off; not built here)
- `POST /api/customer/auto-debit/init { planId }` → `{ authorizationUrl, reference }` (redirect the customer to `authorizationUrl`; it's the ₦50 card-authorization charge).
- `POST /api/customer/auto-debit/verify { reference }` → `{ active: true }` (call on return from Paystack).
- `GET /api/customer/auto-debit?planId=` → `{ status: 'active'|'paused'|'cancelled'|'none', amountPerCycle, nextRunAt, last4, bankName }`.
- `POST /api/customer/auto-debit/cancel { planId }` → `{ status: 'cancelled' }`.
- Online (`source:'self'`) Active plans only. No field ever contains the card authorization code.
