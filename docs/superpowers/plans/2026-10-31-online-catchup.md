# Online Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an online (self) customer on a daily/weekly plan select their missed past contribution days, pay the lump sum by card (Paystack), and have those days show as covered — without backdating the money (interest accrues from payment time only).

**Architecture:** A missed day becomes "covered" via a new `PlanDayCoverage` row (display-only), written in the same transaction that credits one normal `saving` deposit stamped *now*. The savings calendar reads deposits ∪ coverage; interest reads deposits only, so catch-ups never earn back-interest. Payment reuses the existing customer Paystack intent/verify flow, extended to carry the selected day-keys.

**Tech Stack:** Next.js App Router, Prisma + SQLite, customer JWT auth (`getCustomerSession`), Paystack, node:test (tsx).

**Spec:** docs/superpowers/specs/2026-10-31-online-catchup-design.md

## Global Constraints

- **Interest must never read coverage.** `accruedInterest`/`accruedInterestForPlan` stay unchanged; only `Transaction.createdAt` (always "now" for self) drives interest. An explicit test asserts accrued interest is identical before and after a catch-up.
- **Server computes the amount** from the validated day-key set; never trust a client-sent amount.
- **Online/self only, daily/weekly only, missed-past only (incl. today).** No future/pay-ahead slots in V1; monthly plans are blocked from the flow. Auto-debit is untouched.
- **Atomic + idempotent:** credit + coverage insert happen in one `prisma.$transaction`; `Transaction.ref` is `@unique` and `PlanDayCoverage` has `@@unique([savingsPlanId, coversKey])`, so a replay credits/covers exactly once.
- Money rounding via `money()` (`src/lib/wallet-guard`). Local-time day keys via `dateKey` (`src/lib/savings-card`). No new `any`. `@ts-expect-error` with reason, never `@ts-ignore`.
- Mobile WebView UI: works at ~360px, large tap targets, reuse `SavingsCard`/`BottomSheet` and `--ui-*` tokens; no card/auth data logged.
- tsc baseline is 23 errors (no new). node:test files run as parallel processes against one dev.db — scope rows by a per-run id, clean up by id.

## Review Focus

- **Backdating / interest gaming** — paying for a missed day must not change accrued interest. (Task 3 interest-invariance test.)
- **Replay / double-credit** — a repeated verify (or concurrent) must credit + cover once. (Task 3 replay test.)
- **A covered day that later receives a real deposit** — calendar shows it once, day-details reads sensibly. (Task 1 + Task 5.)
- **Monthly plan reaching the flow** — init rejects it; UI hides the entry. (Task 3 + Task 5.)
- **Selecting a day that's already saved/covered, out of schedule, or >90** — init rejects server-side. (Task 3.)

---

## File Structure

- `src/lib/savings-card.ts` — extend `buildSlots` with covered keys; `Slot` gains `coveredOnly`.
- `src/lib/catchup.ts` (new) — pure: per-slot amount, selectable missed keys, selection validation, total. Shared by the init route and the UI.
- `prisma/schema.prisma` — new `PlanDayCoverage`; `PaymentIntent.coversKeys String?`.
- `src/lib/payment-intent.ts` — `createPaymentIntent` accepts optional `coversKeys`.
- `src/app/api/customer/catchup/init/route.ts` (new) — validate + price + Paystack init + intent.
- `src/app/api/customer/paystack/verify/route.ts` — when the intent carries `coversKeys`, also insert coverage rows (same txn); mirror existing `CustomerPayment`/reward writes.
- `src/app/api/customer/me/route.ts` — expose each plan's coverage keys for the calendar.
- `src/app/customer/catchup/page.tsx` (new) + entry point from the plan view; `src/components/customer/SavingsCard.tsx` + `useCardData` for the covered day-details state; `src/app/globals.css` as needed.

---

### Task 1: `buildSlots` reads coverage

**Files:**
- Modify: `src/lib/savings-card.ts`
- Test: `tests/savings-card-coverage.test.ts`

**Interfaces:**
- Consumes: existing `buildSlots(plan, depositDates, now?)`, `dateKey`.
- Produces: `buildSlots(plan, depositDates: string[], coveredKeys?: string[], now?): Slot[]`; `Slot` gains `coveredOnly: boolean` (state is `saved` but no deposit on that key — i.e. covered via catch-up).

- [ ] **Step 1: Failing tests** in `tests/savings-card-coverage.test.ts`:
  - a daily slot whose key is in `coveredKeys` but not in `depositDates` → `state === 'saved'` and `coveredOnly === true`.
  - a slot with a real deposit → `saved`, `coveredOnly === false`.
  - a past slot in neither → `missed`.
  - weekly: a covered key inside a week marks that week `saved`.
- [ ] **Step 2:** Run; expect fail (4th param/`coveredOnly` absent).
- [ ] **Step 3:** Implement: add optional `coveredKeys` → `covered = new Set(...)`; `saved = paid.has(key) || covered.has(key)`; `coveredOnly = !paid.has(key) && covered.has(key)`; default param keeps existing callers working.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5:** Commit.

### Task 2: Schema — coverage table + intent column

**Files:**
- Modify: `prisma/schema.prisma`
- Migration: `prisma/migrations/<ts>_add_plan_day_coverage/`
- Test: `tests/plan-day-coverage.int.test.ts`

**Interfaces:**
- Produces: `model PlanDayCoverage { id; savingsPlanId; coversKey String; ref String; createdAt; @@unique([savingsPlanId, coversKey]) }` + relation on `SavingsPlan`; `PaymentIntent.coversKeys String?` (JSON array of day-keys).

- [ ] **Step 1: Failing test:** create a `PlanDayCoverage` row; a second insert with the same `(savingsPlanId, coversKey)` throws P2002.
- [ ] **Step 2:** Run; expect fail (model missing).
- [ ] **Step 3:** Add the model + column; `npx prisma migrate dev --name add_plan_day_coverage` (additive); `npx prisma generate`.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5:** Commit (schema + migration).

### Task 3: Pure catch-up math + init/verify (MONEY)

**Files:**
- Create: `src/lib/catchup.ts`; Test: `tests/catchup.test.ts`
- Modify: `src/lib/payment-intent.ts`
- Create: `src/app/api/customer/catchup/init/route.ts`
- Modify: `src/app/api/customer/paystack/verify/route.ts`
- Tests: `tests/catchup-init.int.test.ts`, `tests/catchup-verify.int.test.ts`

**Interfaces:**
- `catchup.ts` (pure): `perSlotAmount(plan): number` (daily→`dailyAmount`, weekly→`dailyAmount*7`); `isEligiblePlan(plan): boolean` (status Active, source 'self', cadence daily|weekly); `validateSelection(plan, slots: Slot[], keys: string[]): { ok: true; total: number } | { ok: false; error: string }` (every key is a currently-`missed` slot, unique, 1..90; total = `money(perSlotAmount*count)`).
- `createPaymentIntent({..., coversKeys?: string[]})` persists `coversKeys` as JSON.
- init consumes `getCustomerSession`, `buildSlots`, `catchup.ts`, `customer/paystack/init` pattern; produces `{ authorizationUrl, reference }`.

- [ ] **Step 1: Failing tests (`tests/catchup.test.ts`)** for `perSlotAmount`, `isEligiblePlan` (rejects monthly/offline/non-active), `validateSelection` (rejects a non-missed key, a duplicate, >90, empty; accepts valid missed set with correct total).
- [ ] **Step 2:** Run; fail. **Step 3:** Implement `catchup.ts`. **Step 4:** Run; pass.
- [ ] **Step 5: Failing `tests/catchup-init.int.test.ts`:** customer JWT; a daily self plan with known missed days. init with valid missed keys → 200 `{authorizationUrl, reference}`, a `PaymentIntent` exists with `coversKeys` = the keys and server-computed `amount`. init rejects: monthly plan (400), a future key (400), an already-saved key (400), >90 (400), another customer's plan (403/404). (Paystack `isTestMode` returns a test authorizationUrl.)
- [ ] **Step 6:** Implement `catchup/init` (validate via `catchup.ts` against `buildSlots` built from the plan's deposits; compute amount; `createPaymentIntent` with `coversKeys`; Paystack init). Run; pass.
- [ ] **Step 7: Failing `tests/catchup-verify.int.test.ts`:** with a pending catch-up intent (coversKeys set), calling verify → one `saving` Transaction stamped ~now (NOT a past key), balance += total, one `PlanDayCoverage` row per key, a `CustomerPayment` row written. **Interest-invariance:** `accruedInterestForPlan` identical before and after. Replay → still one credit, same coverage rows. (Reuse the `auto-debit-verify` test harness for Paystack/intent mocking.)
- [ ] **Step 8:** Implement in `paystack/verify`: after consuming the intent, if `intent.coversKeys` is set, insert `PlanDayCoverage` rows (skip-duplicates) inside the same `$transaction` as the credit; keep the existing single `saving` credit (amount = intent.amount), `CustomerPayment`, and first-save reward. Run; pass.
- [ ] **Step 9:** Commit.

### Task 4: `/api/customer/me` exposes coverage keys

**Files:**
- Modify: `src/app/api/customer/me/route.ts`
- Test: `tests/customer-me-coverage.int.test.ts`

**Interfaces:**
- Produces: each plan in the `/me` response gains `coveredKeys: string[]` (from `PlanDayCoverage` for that plan).

- [ ] **Step 1: Failing test:** a plan with a `PlanDayCoverage` row → `/me` returns `coveredKeys` containing that key. **Step 2:** fail. **Step 3:** add the query (scoped to the customer's plan ids) + field. **Step 4:** pass. **Step 5:** Commit.

### Task 5: Customer catch-up UI

**Files:**
- Create: `src/app/customer/catchup/page.tsx` (+ entry point from the plan/home view)
- Modify: `src/components/customer/SavingsCard.tsx` / `useCardData` (covered day-details state), `src/app/globals.css`
- Test: `tests/catchup-ui-logic.test.ts` (pure selection/total via `catchup.ts` — the view itself is covered by the final review)

**Interfaces:**
- Consumes: `/api/customer/me` (`coveredKeys`), `buildSlots` (4-arg), `catchup.ts` (`perSlotAmount`, selectable missed keys, total), `customer/catchup/init`, the `/customer/save/callback` return.

- [ ] **Step 1:** Entry point: on the customer plan view, show a "Catch up" action **only** when the plan is eligible (`isEligiblePlan`) and has ≥1 missed slot; hidden for monthly/ineligible.
- [ ] **Step 2:** Catch-up screen: render the slot calendar (reuse `SavingsCard`/`buildSlots`); make **missed** slots multi-selectable (today included); future/saved/covered not selectable; running total from `catchup.ts`; "Pay ₦X" → POST `catchup/init` → redirect to `authorizationUrl`.
- [ ] **Step 3:** On return, `/customer/save/callback` verifies (existing path); the plan calendar now shows the covered days (via `/me` `coveredKeys`). Give `DayDetails` a `coveredOnly` message ("Covered in a catch-up payment") so a covered day doesn't read as "nothing saved".
- [ ] **Step 4:** Loading/empty/error states; amounts via `formatNaira`; `hideAmounts` respected.
- [ ] **Step 5:** `tsc --noEmit` at baseline; commit.

---

## Self-review notes

- Spec coverage: credit-now (T3), coverage markers (T1/T2/T3), calendar reads coverage (T1/T4/T5), interest untouched (T3 invariant test), daily/weekly only + monthly blocked (T3 `isEligiblePlan`, T5 entry gate), missed-only (T3 `validateSelection`, T5 selectability), Paystack reuse (T3). ✓
- Review-focus items each have an owning test (T3 interest-invariance, T3 replay, T3 rejects, T1 covered+deposit). ✓
- Types consistent: `buildSlots` 4-arg and `Slot.coveredOnly` used the same way in T1/T5; `coversKeys`/`coveredKeys` naming — `coversKeys` on the intent (input), `coveredKeys` on `/me` + `buildSlots` (output). Keep that split explicit.
