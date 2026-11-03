# Commission restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner chose inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unused per-deposit savings commission with the agreed model: offline daily plans give one first day's amount to the platform and agent, offline weekly and monthly plans take a configurable fee from each deposit, both split by Super Admin percentages; online plans pay nothing.

**Architecture:** Pure fee functions (`src/lib/savings-fee.ts`) decide every amount. A deposit-time op writes the fee, balances and ledger inside the deposit transaction. At collection, a one-off settle-up covers whatever was not yet taken (plans that started before go-live). The existing `commissionGoLive` date still gates all of it. The Commission page and the plan previews are rebuilt around three new settings.

**Tech Stack:** Next.js App Router, Prisma on SQLite, `node:test` via `npx tsx --test tests/<file>`.

**Spec:** `docs/superpowers/specs/2026-11-03-commission-restructure-design.md`

## Global Constraints

- Money is `Float`; round every amount with `money()` from `src/lib/money.ts`; agent share + platform share must equal the fee exactly (platform = fee minus the rounded agent share).
- Fee applies only to plans with `source !== 'self'`, only for deposits dated at or after `commissionGoLive`, and only when it is set. Before that, behavior is exactly today's.
- Commission is credited by adding to `Agent.commissionBalance`; the platform share goes to the `Revenue` `PlatformWallet`. Agent payout (withdrawals) is untouched.
- Every fee, balance change and ledger row for one event is written in the same `prisma.$transaction`. Ledger rows are append-only and unique per (source, sourceRef, party).
- Migrations are forward-only and additive (`ALTER TABLE ... ADD COLUMN`); verify on a scratch copy of the database, never apply to the main folder's `dev.db`, never `migrate reset` or `db push`.
- Rate keys and units: all values are percent 0 to 100; `periodicFeePct` is capped at 25; loan caps stay (10, 10, 50); saving rates needs the approval PIN.
- Reads of settings and plan fee state happen per request inside the transaction; no caching.
- Run `npx tsc --noEmit` and compare the **total** error count to the baseline of 23 (not just changed files), and run `grep -rn <removed export> src` for every export you remove.
- No new `any`; no commit message carries a Claude attribution line; stage only your own files.

## Review Focus

- The first day's amount is taken exactly once however it is paid: one deposit, several days in one bulk request, or two part-payments (test: three deposits of 300 on a daily plan of 500 take 500 in total).
- A deposit smaller than what is still owed is all fee and credits the plan 0, without failing.
- A deposit dated before go-live takes no fee, and the same money is picked up by the collection settle-up.
- Online `self` plans take no fee at deposit, no settle-up and show no fee in previews.
- Editing a rate between a collection request and its approval changes neither the customer's net payout nor the stored agent/platform split.
- A collection request created before go-live (`feeRule = 'v1'`) is still approved with the old fee and 60/40 split.
- Agent share and platform share always add up to the fee to the kobo, including 7.5% of an odd amount.
- A running daily plan with no fee yet takes the first day's amount from its next deposit after go-live.

## File Structure

- Create `src/lib/savings-fee.ts` (pure, client-safe), `src/app/api/plan-fees/route.ts`, `src/app/api/admin/early-redemption/preview/route.ts`.
- Modify `src/lib/commission-rates.ts`, `src/lib/commission-ledger.ts`, `src/lib/wallet-rates.ts`, `src/lib/redemption-complete.ts`, `src/lib/commission-history.ts`, the five deposit sites, the three redemption request routes, `finalize-otp` route, the early-redemption GET and page, the Commission page and APIs, the plan preview screens, receipts.
- Migration: one new migration adding `SavingsPlan.feeCollected`, `Transaction.feeTaken`, `EarlyRedemption.feeAgent`.
- Tests: `tests/savings-fee.test.ts` (new), `tests/commission-rates.test.ts`, `tests/commission-ledger.test.ts`, `tests/commission-history.test.ts`.

---

### Task 5: Pure fee functions

**Files:** Create `src/lib/savings-fee.ts`; Test `tests/savings-fee.test.ts`.

**Interfaces:**
- Produces: `interface FeeRules { dailyFirstAgentPct: number; periodicFeePct: number; periodicAgentPct: number }`; `interface FeeSplit { fee: number; agent: number; platform: number }`.
  - `depositFee(i: { cadence: string | null; dailyAmount: number; feeCollected: number; deposit: number }, r: FeeRules): FeeSplit`. Daily (`cadence` null or `'daily'`): fee = `min(deposit, max(0, dailyAmount - feeCollected))`, agent share `dailyFirstAgentPct`. Weekly or monthly: fee = `pct(deposit, periodicFeePct)`, agent share `periodicAgentPct`.
  - `settleUpFee(i: { cadence: string | null; dailyAmount: number; feeCollected: number; balance: number; preGoLiveDeposits: number }, r: FeeRules): FeeSplit`. Daily: `min(max(0, dailyAmount - feeCollected), balance)`. Weekly or monthly: `pct(min(preGoLiveDeposits, balance), periodicFeePct)`; never negative.
  - `planFeePreview(i: { cadence: string | null; amountPerPayment: number; totalSaved: number; periodicFeePct: number }): { kind: 'first-day' | 'percent'; total: number }`: daily gives `{ kind: 'first-day', total: amountPerPayment }`; weekly or monthly gives `{ kind: 'percent', total: pct(totalSaved, periodicFeePct) }`.
  - Split rule: `agent = pct(fee, agentPct)`, `platform = money(fee - agent)`.

- [ ] **Step 1: Write failing tests** in `tests/savings-fee.test.ts` with the spec's values: daily 500, nothing collected, deposit 500 gives fee 500 agent 300 platform 200 at 60%; deposit 1500 gives fee 500; deposit 300 then 300 then 300 take 300, 200, 0 as `feeCollected` rises; deposit 100 with 500 owed gives fee 100; a 7.5% fee on 1,001 gives fee 75.08 and agent + platform = 75.08 at 60%; `periodicFeePct` 0 gives 0; settle-up daily with `feeCollected` 0, daily 500, balance 300 gives 300; settle-up weekly with 40,000 pre-go-live and balance 30,000 at 7.5% gives 2,250; settle-up never negative; `planFeePreview` daily 500 gives 500 (first-day), weekly with totalSaved 100,000 at 7.5% gives 7,500 (percent).
- [ ] **Step 2: Run** `npx tsx --test tests/savings-fee.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the signatures above using `pct` from `commission-rates` and `money` from `money.ts`; no server imports.
- [ ] **Step 4: Run** the tests. Expected: all pass.
- [ ] **Step 5: Commit** `feat(commission): pure fee functions for the new savings model`.

---

### Task 6: Schema

**Files:** `prisma/schema.prisma`; new migration directory `prisma/migrations/<timestamp>_add_savings_fee_columns/migration.sql`.

**Interfaces:** `SavingsPlan.feeCollected Float @default(0)`; `Transaction.feeTaken Float @default(0)`; `EarlyRedemption.feeAgent Float @default(0)`.

- [ ] **Step 1: Edit the schema** with the three columns.
- [ ] **Step 2: Hand-write the migration** as three `ALTER TABLE ... ADD COLUMN ... REAL NOT NULL DEFAULT 0` statements (the generator rebuilds tables; do not use its output).
- [ ] **Step 3: Verify on a scratch copy:** `cp prisma/dev.db <scratchpad>/verify.db`, apply the SQL with `sqlite3`, confirm the three columns with `pragma table_info`. Expected: no errors. Run `npx prisma validate` and `npx prisma generate`.
- [ ] **Step 4: Commit** `feat(commission): fee columns on plans, transactions and redemptions`.

---

### Task 7: The engine: rates, deposit fee, collection settle-up

**Files:**
- Modify `src/lib/commission-rates.ts`: replace `agentSavings` and `platformSavings` with `dailyFirstAgentPct` (default 60), `periodicFeePct` (7.5), `periodicAgentPct` (60); `validateRates` caps `periodicFeePct` at 25; stored JSON that still has the old keys is read with the new keys defaulted and the old ones ignored; add `feeRulesOf(r: CommissionRates): FeeRules`.
- Modify `src/lib/commission-ledger.ts`: remove `savingsCommissionOps`, `redemptionFee`, `catchupBase`, `completionSplit`, `feeContext` (old forms); add the functions below; keep `recordCommission`, `getGoLive`, `isNewModelLive`, loan helpers.
- Modify `src/lib/wallet-rates.ts`: remove the `platformSavingsPct` option (legacy fee stays for requests before go-live).
- Modify the five deposit sites (`api/transactions/saving/route.ts`, `api/transactions/saving/bulk/route.ts`, `api/customer/auto-debit/verify/route.ts`, `lib/auto-debit-credit.ts`, `lib/customer-settle.ts`): call `depositFeeOps` before creating the transaction, store `feeTaken` on it, and credit the plan `amount - fee` instead of `amount` (in the bulk route, once per day created, in order).
- Modify the three request routes (`api/admin/early-redemption/route.ts`, `api/transactions/redemption/request/route.ts`, `api/customer/redeem/route.ts`) to use `collectionFee`, store `feeRule`, `penalty` and `feeAgent`.
- Modify `src/lib/redemption-complete.ts` and `api/admin/early-redemption/[id]/finalize-otp/route.ts` to use the new `completionCredits`.
- Test: `tests/commission-rates.test.ts`, `tests/commission-ledger.test.ts` (stub-transaction style, no database).

**Interfaces:**
- Consumes: `depositFee`, `settleUpFee`, `FeeRules` (Task 5); columns (Task 6).
- Produces in `commission-ledger.ts`:
  - `depositFeeOps(tx: LedgerClient, i: { planId: string; agentId: string | null; customerId: string; amount: number; ref: string; at: Date }): Promise<number>`: returns the fee taken (0 when not live, plan is `self`, or deposit predates go-live). Reads the plan (`cadence, dailyAmount, source, feeCollected`) inside `tx`; computes `depositFee`; increments `plan.feeCollected`, `Agent.commissionBalance` (agent share, only when `agentId` is set), and the `Revenue` wallet (platform share, plus the agent share if there is no agent); writes ledger rows (`daily_first` or `periodic_fee`, party `agent` and `platform`, `sourceRef` = `ref`); returns 0 and writes nothing if an agent row for that `ref` already exists.
  - `collectionFee(client: Pick<PrismaClient, 'platformSetting' | 'transaction'>, plan: { id: string; cadence: string | null; dailyAmount: number; source: string | null; feeCollected: number }, balance: number, at: Date): Promise<{ feeRule: 'v1' } | { feeRule: 'v2'; penalty: number; feeAgent: number }>`: `v1` when not live; otherwise sums the plan's `saving` transactions dated before go-live, calls `settleUpFee`, and returns the total as `penalty` and the agent part as `feeAgent`; `self` plans give `penalty 0, feeAgent 0`.
  - `completionCredits(tx, rec: { ref; savingsPlanId; balance; penalty; feeRule; feeAgent }, agentId: string, customerId: string | null): Promise<{ agentCredit: number; platformCredit: number }>`: `v1` splits `penalty` 3/5 and 2/5 as today and writes the old `redemption_fee` rows; `v2` credits `feeAgent` to the agent and `penalty - feeAgent` to the platform, writing `settle_up` rows.

- [ ] **Step 1: Write failing tests.** Rates: defaults include the three new keys and not the old; old stored keys are ignored; `periodicFeePct` 26 is rejected and 25 accepted. Ledger, with a stub transaction: `depositFeeOps` on a daily plan of 500 with nothing collected and a live model takes 500, credits the agent 300, writes an agent row and a platform row with source `daily_first`, and raises `feeCollected` by 500; the next deposit takes 0; three deposits of 300 take 300, 200, 0; a deposit dated before go-live takes 0; a `self` plan takes 0; a weekly 1,000 deposit at 7.5% takes 75 split 45 and 30; a replay of the same `ref` takes 0; no agent sends the whole fee to Revenue. `collectionFee`: not live gives `v1`; live daily plan with 0 collected, daily 500 and balance 5,000 gives penalty 500 and feeAgent 300; weekly with 40,000 pre-go-live gives 3,000 at 7.5%; `self` gives 0. `completionCredits`: `v2` returns `{ agentCredit: feeAgent, platformCredit: penalty - feeAgent }` and writes `settle_up` rows; `v1` with penalty 1,000 returns 600 and 400.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement** the rates changes and the three functions above; delete the removed functions and run `grep -rn "savingsCommissionOps\|feeContext\|catchupBase\|redemptionFee\|completionSplit\|agentSavings\|platformSavings" src tests` until only intended uses remain.
- [ ] **Step 4: Rewire** the five deposit sites, three request routes, `redemption-complete.ts` and `finalize-otp` as listed. In each request route, read the plan's `feeCollected` and pass the plan to `collectionFee`; when `feeRule` is `v2`, `penalty` replaces the old `deduction`, otherwise use the old `redemptionDeduction` exactly as now.
- [ ] **Step 5: Run** the unit tests (all non-integration files with `npx tsx --test $(ls tests/*.test.ts | grep -v '\.int\.test\.ts')`; the two files that need `NEXTAUTH_SECRET` pass with it set) and `npx tsc --noEmit`, confirming the total stays at 23.
- [ ] **Step 6: Commit** `feat(commission): daily first-day split and weekly/monthly deposit fee, with a settle-up at collection`.

---

### Task 8: Previews, receipts and copy

**Files:** Create `src/app/api/plan-fees/route.ts` and `src/app/api/admin/early-redemption/preview/route.ts`; modify `src/app/dashboard/savings/page.tsx` (`deductionPreview`), `src/app/dashboard/add-plan/page.tsx`, `src/app/dashboard/enrol/page.tsx`, `src/app/customer/enroll/page.tsx` (plan previews and agreement copy), `src/app/superadmin/early-redemption/page.tsx` (new-request preview), the customer and agent receipt components (fee row).

**Interfaces:**
- Produces: `GET /api/plan-fees` returns `{ live: boolean; periodicFeePct: number }` for an agent or customer session (401 otherwise). `GET /api/admin/early-redemption/preview?planId=<id>` (requires `redemptions` view) returns `{ balance: number; fee: number; netPayout: number }` using `collectionFee` when live and the old `redemptionDeduction` otherwise.

- [ ] **Step 1: Write a failing test** for the plan-fees route's response shape through a pure helper `buildPlanFees(live: boolean, rates: CommissionRates): { live: boolean; periodicFeePct: number }` in `commission-ledger.ts` (`live` false still returns the saved percent), then implement it.
- [ ] **Step 2: Implement the two routes** and wire the previews: when `live` is true the "Platform fee" line shows the first day's amount (daily) or the percentage of the total (weekly, monthly) and the agreement text says so; when false the existing preview stays. Offline plans only; nothing for self plans.
- [ ] **Step 3: Receipts:** show a "Platform fee" row when a transaction's `feeTaken` is above 0 (customer History receipt and the agent transaction page); include `feeTaken` in the API responses that feed them.
- [ ] **Step 4: Verify** `tsc` total 23, and in Chrome (dev server only if none is running) check the agent add-plan preview at 360px for a daily and a weekly plan.
- [ ] **Step 5: Commit** `feat(commission): plan previews, receipts and copy follow the new fee model`.

---

### Task 9: Rebuild the Commission page

**Files:** `src/app/superadmin/commission/page.tsx`, `src/app/api/admin/commission/rates/route.ts`, `src/app/superadmin/admin.css` (only if the layout needs it).

**Interfaces:** the rates API accepts and returns the keys from Task 7 plus the loan keys and `platformPenalty`; the PIN check, audit with old to new values, and caps stay.

- [ ] **Step 1: Restructure the rates section** into three groups with plain headings: "Daily plans" (agent share of the first day's amount, with a live example "On a ₦500 a day plan, ₦500 is the platform fee: agent ₦X, platform ₦Y"), "Weekly and monthly plans" (platform fee percent, agent share of that fee, with an example on a ₦10,000 deposit), and "Loans" (agent loan, repayment, platform share of interest). The late penalty stays as "Not applied yet". A line states that online customers pay no fee.
- [ ] **Step 2: Update the confirm dialog** diff list, reset-to-defaults, the PIN field and the "total take" footer text for the new keys.
- [ ] **Step 3: Verify** `tsc` total 23 and, with a super admin session if available, change a rate and enter the PIN; otherwise state that this was not browser-checked.
- [ ] **Step 4: Commit** `feat(commission): rebuilt Commission settings page`.

---

### Task 10: History, System commission, cleanup

**Files:** `src/lib/commission-history.ts`, `src/app/api/admin/commission/route.ts`, the history route, `src/app/superadmin/_components/commission-history-drawer.tsx`, `tests/commission-history.test.ts`.

**Interfaces:** `LEDGER_SOURCE` maps `daily_first` and `periodic_fee` to the `savings` source and `settle_up` to `redemption`; `systemCommission` sums platform rows from the new sources as `savingsFees` (all savings-related sources) alongside `loanShare`.

- [ ] **Step 1: Write failing tests:** `entriesFromLedger` maps the three new sources as above; `mergeHistory` still dedupes.
- [ ] **Step 2: Implement**, then confirm `grep -rn "savings_catchup" src tests` returns nothing.
- [ ] **Step 3: Run** the three commission test files and `tsc` (total 23).
- [ ] **Step 4: Commit** `feat(commission): history and system commission cover the new fee sources`.

---

### Task 11: Final check, rollout notes and a dark deploy

- [ ] **Step 1: Full checks:** all non-integration unit tests, `tsc` total 23, and the self-review of the Review Focus list against the code.
- [ ] **Step 2: Update `docs/superpowers/plans/2026-11-03-commission-rollout.md`** for the new model with a before and after table for three sample plans (daily ₦500 a day with ₦60,000 saved, weekly ₦10,000, online) and the go-live steps; remove the stale numbers.
- [ ] **Step 3: Commit** `docs: commission rollout checklist for the new model`. Do not push, deploy or run the go-live script: each needs the owner's approval.
