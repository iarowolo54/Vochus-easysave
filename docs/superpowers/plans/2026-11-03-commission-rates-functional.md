> **SUPERSEDED 2026-11-03** for savings by `2026-11-03-commission-restructure.md`. Loans and repayments (Tasks 1 to 4) are built and live; the savings parts below were never switched on and are being replaced.

# Commission rates that control real money: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The super admin rates page drives every commission and fee; agents are paid per savings deposit (Option A); every commission and platform fee is written once to an append-only ledger; the page shows the system's own commission.

**Architecture:** One `getCommissionRates()` reads the saved rates. A small ledger module writes `CommissionLedger` rows inside the same transaction as the event. The new savings model (deposit commission plus the new redemption fee) is gated by a `commissionGoLive` date setting, so all code ships dark and one script switches it on for both halves at once. Money maths lives in pure functions that are unit-tested with a stub transaction object, so no test touches `dev.db`.

**Tech Stack:** Next.js (App Router), Prisma on SQLite, `node:test` run through `tsx` (`npx tsx --test tests/<file>`).

**Spec:** `docs/superpowers/specs/2026-11-03-commission-rates-functional-design.md`

## Global Constraints

- Money is `Float`; round every credited or debited amount with `money()` from `src/lib/wallet-guard.ts`.
- Credit commission only by incrementing `Agent.commissionBalance`; do not touch `PlatformWallet` except the Revenue credit the redemption already does. Payout of commission stays the existing withdrawal flow.
- A ledger row is written in the same `prisma.$transaction` as the event it records, and never updated or deleted. Row amounts of 0 are not written.
- `source = 'self'` plans earn no commission and pay no fee.
- Rates are percent: agent and platform savings are percent of each deposit amount (and of the balance at redemption); agent loan is percent of principal; agent repay is percent of the repayment; platform loan is percent of interest.
- Reads go to the database per request. No caching of rates or the go-live date (two server instances share one SQLite file).
- Migrations are forward-only. Never run `prisma migrate reset`, `db push --accept-data-loss`, or `migrate dev` against the main folder's `dev.db`. Verify migrations on a scratch copy of the database.
- No new `any`; `npx tsc --noEmit` must show no new errors in changed files. No commit message may carry a Claude attribution line.
- Write only your own files when staging; another session may have uncommitted work in the tree.

## Review Focus

- A retried webhook, retried request or double-click on a deposit pays the agent once (unique ledger key, `ALREADY_PROCESSED` paths untouched).
- Editing rates between a redemption request and its approval does not change the pending payout (fee is stored at request; approval reads the stored number).
- A redemption requested before go-live (`feeRule = 'v1'`) and approved after still splits its stored fee 3/5 agent, 2/5 platform and gets no catch-up.
- A stored rates value that is missing, partial or not a number falls back to the defaults, never to `NaN` or 0.
- A customer whose agent is missing or suspended, and a deposit that rounds to a 0 commission, write no row and do not fail the deposit.
- A rate of 0 for agent savings or platform savings is valid (no credit, no fee).

## File Structure

- Create `src/lib/commission-rates.ts`: rates shape, defaults, parse, read, validation.
- Create `src/lib/commission-ledger.ts`: `recordCommission`, `savingsCommissionOps`, `redemptionFee`, `catchupBase`, `getGoLive`, `isNewModelLive`.
- Create `scripts/commission-go-live.ts`: sets the go-live date.
- Modify `prisma/schema.prisma` and add one migration.
- Modify the five deposit sites, three redemption-request routes, `redemption-complete.ts`, `wallet-rates.ts`, loan disburse and repay routes, the rates API, the commission API and page, the early-redemption GET and page, and `commission-history.ts` (details in tasks).
- Tests: `tests/commission-rates.test.ts`, `tests/commission-ledger.test.ts`, extend `tests/commission-history.test.ts`.

---

### Task 1: Rates module

**Files:**
- Create: `src/lib/commission-rates.ts`
- Modify: `src/lib/wallet-rates.ts` (delete `CommissionRates`, `DEFAULT_COMMISSION_RATES`, `getStoredCommissionRates`; re-export nothing; callers move to the new module)
- Modify: `src/app/api/admin/commission/rates/route.ts` (use the module's defaults and `validateRates`)
- Test: `tests/commission-rates.test.ts`

**Interfaces:**
- Produces: `interface CommissionRates { agentSavings; agentLoan; agentRepay; platformSavings; platformLoan; platformPenalty: number }`, `const DEFAULT_COMMISSION_RATES: CommissionRates` (0.4, 1.0, 0.5, 1.6, 5.0, 2.0), `parseCommissionRates(raw: unknown): CommissionRates` (field-by-field: a finite number from 0 to 100 is kept, anything else takes that field's default), `getCommissionRates(client: Pick<PrismaClient,'platformSetting'>): Promise<CommissionRates>`, `validateRates(rates: unknown): { ok: true; rates: CommissionRates } | { ok: false; error: string }` (every key present, finite number 0 to 100, and `agentSavings + platformSavings <= 10`), `pct(amount: number, ratePct: number): number` (money-rounded `amount * ratePct / 100`).

- [ ] **Step 1: Write the failing tests** in `tests/commission-rates.test.ts`: `parseCommissionRates` keeps valid fields and defaults the rest (`{agentSavings: 'x', agentLoan: 2}` gives agentSavings 0.4, agentLoan 2); `parseCommissionRates(null)` and `parseCommissionRates('junk')` give the defaults; `validateRates` rejects a missing key, a negative, a value over 100, and `agentSavings 6 + platformSavings 5`; accepts `agentSavings 0` and exactly 10 combined; `pct(1000, 0.4) === 4`, `pct(33.33, 1.5) === 0.5`.
- [ ] **Step 2: Run** `npx tsx --test tests/commission-rates.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the interfaces above in `src/lib/commission-rates.ts`; `getCommissionRates` reads `platformSetting` key `commissionRates`, JSON-parses inside try/catch, and returns `parseCommissionRates(parsed)`.
- [ ] **Step 4: Move callers.** Point the rates API GET/POST at the module (POST uses `validateRates` and still writes the same JSON). `grep -rn getStoredCommissionRates src` must then return nothing.
- [ ] **Step 5: Run** the test (expected PASS) and `npx tsc --noEmit 2>&1 | grep -E "commission-rates|wallet-rates|commission/rates"` (expected empty).
- [ ] **Step 6: Commit** `feat(commission): one place that reads and validates the rates`.

---

### Task 2: Schema, go-live setting and script

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/<timestamp>_add_commission_ledger/migration.sql`
- Create: `scripts/commission-go-live.ts`

**Interfaces:**
- Produces: Prisma model `CommissionLedger { id String @id @default(cuid()); party String; agentId String?; source String; sourceRef String; customerId String?; base Float; ratePct Float; amount Float; createdAt DateTime @default(now()); @@unique([source, sourceRef, party]); @@index([agentId, createdAt]); @@index([party, createdAt]) }`. `party` is `agent` or `platform`; `source` is one of `savings`, `savings_catchup`, `loan`, `repayment`, `redemption_fee`. `EarlyRedemption.feeRule String @default("v1")`. Setting key `commissionGoLive` holds an ISO timestamp.

- [ ] **Step 1: Edit the schema** with the model and column above (no relation fields; ids are plain strings like `AuditLog`).
- [ ] **Step 2: Generate the migration SQL** with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` using a copy of the previous schema as the from side (`git show HEAD:prisma/schema.prisma > <scratchpad>/old.prisma`, then `--from-schema-datamodel <scratchpad>/old.prisma`). Save the output as the new migration file. It must contain only a `CREATE TABLE`, its indexes, and one `ALTER TABLE "EarlyRedemption" ADD COLUMN "feeRule"`.
- [ ] **Step 2b: Verify on a scratch copy.** `cp prisma/dev.db <scratchpad>/verify.db`, apply the SQL with `sqlite3 <scratchpad>/verify.db < migration.sql`, then `sqlite3 <scratchpad>/verify.db ".schema CommissionLedger"` shows the table and `select feeRule from EarlyRedemption limit 1` runs. Expected: no errors.
- [ ] **Step 3: Write `scripts/commission-go-live.ts`**: with no arguments prints the current setting; with `--now` upserts `commissionGoLive` to `new Date().toISOString()` and refuses (exit 1) if it is already set unless `--force` is given. It uses the shared `prisma` client. Do not run it.
- [ ] **Step 4: `npx prisma validate` and `npx prisma generate`** (generate only in the main folder, which is the one owner of this client). Expected: valid.
- [ ] **Step 5: Commit** `feat(commission): ledger table, fee rule column, go-live script`.

---

### Task 3: Ledger module (pure money functions)

**Files:**
- Create: `src/lib/commission-ledger.ts`
- Test: `tests/commission-ledger.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CommissionRates`, `pct`, `getCommissionRates`), Task 2 model.
- Produces:
  - `type LedgerClient = Prisma.TransactionClient` and `type LedgerSource = 'savings' | 'savings_catchup' | 'loan' | 'repayment' | 'redemption_fee'`.
  - `recordCommission(tx: LedgerClient, e: { party: 'agent' | 'platform'; agentId: string | null; source: LedgerSource; sourceRef: string; customerId: string | null; base: number; ratePct: number; amount: number }): Promise<void>`: no-op when `money(amount) <= 0`; otherwise `commissionLedger.upsert` on the unique key `{source, sourceRef, party}` with `update: {}`.
  - `savingsCommissionOps(tx: LedgerClient, i: { agentId: string | null; customerId: string; planSource: string | null; amount: number; ref: string; at: Date }): Promise<number>`: returns the amount credited. Does nothing and returns 0 when the new model is not live at `i.at`, `planSource === 'self'`, `agentId` is null, or the agent's rate gives 0. Otherwise increments `Agent.commissionBalance` by `pct(amount, agentSavings)` and records an agent `savings` row, only when the ledger upsert created a new row (so a replay does not credit twice: check by `findUnique` before, in the same transaction).
  - `redemptionFee(balance: number, platformSavingsPct: number, planSource: string | null): number`: 0 for `self`, else `pct(balance, platformSavingsPct)`.
  - `catchupBase(preGoLiveDeposits: number, balance: number): number`: `min(preGoLiveDeposits, balance)`, never negative, money-rounded.
  - `getGoLive(client: Pick<PrismaClient,'platformSetting'>): Promise<Date | null>`; `isNewModelLive(client, at: Date): Promise<boolean>` (true when the date is set and `at >= date`).

- [ ] **Step 1: Write failing tests** with a stub `tx` (plain object recording calls to `commissionLedger.findUnique/upsert` and `agent.update`, and a stub `platformSetting.findUnique`): live model credits `pct(1000, 0.4) = 4` and writes one agent row with `source 'savings'`, `sourceRef` equal to the deposit ref; not live (no setting, or `at` before the date) credits nothing; `planSource 'self'` credits nothing; `agentId null` credits nothing; a second call with the same ref (stub `findUnique` returns a row) credits nothing; a deposit of ₦1 at 0.4% rounds to 0.00 and writes no row; `redemptionFee(62000, 1.6, null) === 992`, `redemptionFee(62000, 1.6, 'self') === 0`, `redemptionFee(100, 0, null) === 0`; `catchupBase(5000, 3000) === 3000`, `catchupBase(-1, 3000) === 0`.
- [ ] **Step 2: Run** `npx tsx --test tests/commission-ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** the test; expected PASS. Then `npx tsc --noEmit 2>&1 | grep commission-ledger` expected empty.
- [ ] **Step 5: Commit** `feat(commission): ledger writer and the savings money functions`.

---

### Task 4: Loans and repayments read the rates

**Files:**
- Modify: `src/app/api/loans/[id]/disburse/route.ts` (lines around 26-27), `src/app/api/loans/[id]/repay/route.ts` (around 30), `src/lib/wallet-rates.ts` (remove `LOAN_AGENT_COMMISSION`, `LOAN_PLATFORM_FEE`, `LOAN_REPAY_AGENT_COMMISSION` once nothing uses them)
- Test: extend `tests/commission-ledger.test.ts`

**Interfaces:**
- Consumes: `getCommissionRates`, `pct`, `recordCommission`. Produces: loan commission `pct(principal, agentLoan)` and platform revenue `pct(interestAmount, platformLoan)`; repayment commission `pct(amount, agentRepay)`.

- [ ] **Step 1: Write a failing test** for a small exported helper `loanCommissionAmounts(rates: CommissionRates, principal: number, interest: number): { agent: number; platform: number }` in `commission-ledger.ts`: at defaults, principal 50000 and interest 3600 give agent 500 and platform 180; with `agentLoan 2` agent is 1000. Also `repaymentCommissionAmount(rates, amount)`: 33600 at defaults gives 168.
- [ ] **Step 2: Run, expect FAIL; implement the two helpers; run, expect PASS.**
- [ ] **Step 3: Wire the routes.** Read rates once before the transaction; inside the existing transaction replace the constants with the helper results and call `recordCommission` for the agent row (`source 'loan'` / `'repayment'`, `sourceRef` the transaction ref) and, for disbursement, a platform row (`source 'loan'`, `party 'platform'`, `agentId null`). The balance changes and the existing `transaction.create` stay as they are.
- [ ] **Step 4:** `grep -rn "LOAN_AGENT_COMMISSION\|LOAN_PLATFORM_FEE\|LOAN_REPAY_AGENT_COMMISSION" src` must return only `commission-history.ts`; Task 8 removes that.
- [ ] **Step 5: Verify** `npx tsc --noEmit 2>&1 | grep -E "loans/\[id\]|commission-ledger"` (expected empty) and run the new tests.
- [ ] **Step 6: Commit** `feat(commission): loan and repayment commission follow the rates page`.

---

### Task 5: Agent commission on every savings deposit

**Files:**
- Modify the five places that create a `type: 'saving'` transaction, calling `savingsCommissionOps` inside their existing transaction right after the plan credit: `src/app/api/transactions/saving/route.ts` (~line 79), `src/app/api/transactions/saving/bulk/route.ts` (~111, once per created transaction), `src/app/api/customer/auto-debit/verify/route.ts` (~125), `src/lib/auto-debit-credit.ts` (~62), `src/lib/customer-settle.ts` (~81).

**Interfaces:**
- Consumes: `savingsCommissionOps(tx, { agentId, customerId, planSource, amount, ref, at })` from Task 3. Pass the customer's agent id (`customer.agentId` / `agent.id`), the plan's `source`, the transaction ref and its `createdAt` (or `new Date()` when the deposit has none).

- [ ] **Step 1: Write a failing test** for `savingsCommissionOps` with a plan dated before go-live: a deposit whose `at` is before the go-live date credits nothing even when the model is live now (backdated agent deposits on offline plans must not earn). Add to `tests/commission-ledger.test.ts`; run, expect FAIL if the earlier task did not already cover it, otherwise PASS.
- [ ] **Step 2: Wire each site**, keeping the existing error handling. The deposit must not fail because commission could not be written: no try/catch around it (it is inside the transaction, so a failure rolls the deposit back, which is the intended all-or-nothing behavior).
- [ ] **Step 3: Verify** `grep -rn "savingsCommissionOps" src` lists exactly the five files and `tsc` shows no new errors in them. Run `npx tsx --test tests/commission-ledger.test.ts`.
- [ ] **Step 4: Commit** `feat(commission): agents earn the agent savings rate on every deposit once live`.

(Because of the go-live gate this changes no live behavior until the script in Task 2 is run.)

---

### Task 6: New redemption fee and the older-plan catch-up

**Files:**
- Modify: `src/lib/wallet-rates.ts` (`redemptionDeduction`), `src/app/api/admin/early-redemption/route.ts` (~148), `src/app/api/transactions/redemption/request/route.ts` (~83), `src/app/api/customer/redeem/route.ts` (~93), `src/lib/redemption-complete.ts`, `src/app/api/admin/early-redemption/route.ts` GET (add `platformSavingsPct`), `src/app/superadmin/early-redemption/page.tsx` (preview at ~278)
- Test: extend `tests/commission-ledger.test.ts`

**Interfaces:**
- Consumes: `redemptionFee`, `catchupBase`, `isNewModelLive`, `getCommissionRates`, `recordCommission`.
- Produces: `redemptionDeduction` keeps its name and shape `{ total, platform, agent }` but gains an optional `platformSavingsPct?: number`; when given it returns `{ total: fee, platform: fee, agent: 0 }` with `fee = redemptionFee(balance, platformSavingsPct, source)`. Without it, the legacy result is unchanged. `RedemptionRecord` gains `feeRule: string`.

- [ ] **Step 1: Write failing tests:** `redemptionDeduction({ balance: 62000, ..., platformSavingsPct: 1.6 })` returns total 992, platform 992, agent 0; with `source: 'self'` returns zeros; without `platformSavingsPct` the old cash-daily result for balance 31000 is still total 1000. Add a pure helper `completionSplit(rec: { penalty: number; feeRule: string }, catchupAmount: number): { agentCredit: number; platformCredit: number }` to `commission-ledger.ts`: `v1` returns `{ agent: penalty*3/5, platform: penalty*2/5 }` ignoring the catch-up; `v2` returns `{ agent: catchupAmount, platform: penalty }`. Test both, including a `v1` record with a non-zero catch-up (agent credit stays 3/5 of penalty).
- [ ] **Step 2: Run, expect FAIL; implement `redemptionDeduction` change and `completionSplit`; run, expect PASS.**
- [ ] **Step 3: Request routes.** In the three routes, when `isNewModelLive(prisma, now)` is true, read rates, pass `platformSavingsPct` to `redemptionDeduction`, and create the redemption record with `feeRule: 'v2'`; otherwise behave exactly as today (`feeRule` default `'v1'`). The admin preview page uses `platformSavingsPct` from the early-redemption GET when it is present, else the old call.
- [ ] **Step 4: Completion.** In `redemptionCompletionOps`, replace the fixed 3/5 and 2/5 with `completionSplit`. For `v2`, compute the catch-up inside the same transaction: sum of the plan's `saving` transactions with `createdAt` before the go-live date, `catchupBase(sum, record.balance)`, times the agent savings rate via `pct`; credit it to `commissionBalance`, write agent ledger row `savings_catchup` (`sourceRef` = redemption ref) and a platform row `redemption_fee` (`sourceRef` = redemption ref, `base` = balance). For `v1`, write the same two ledger rows with the old 3/5 and 2/5 amounts under source `redemption_fee` (agent row) and `redemption_fee` (platform row) so system commission includes them. Revenue wallet credit equals `platformCredit`.
- [ ] **Step 5: Verify** `tsc` for the changed files, the new tests, and read the three request routes to confirm `feeRule: 'v2'` is only set in the live branch.
- [ ] **Step 6: Commit** `feat(commission): redemption fee is the platform savings rate; agents get a catch-up on older deposits`.

---

### Task 7: Rates page, system commission figure, history

**Files:**
- Modify: `src/app/api/admin/commission/rates/route.ts` (require `pin` in the POST body and check it with `verifyApprovalPin(session, pin)` before saving, as `early-redemption/[id]` does), `src/app/superadmin/commission/page.tsx` (PIN prompt on save using the existing PIN modal pattern on that page or `early-redemption/page.tsx`; late penalty row labelled "Not applied yet"; a "System commission" stat), `src/app/api/admin/commission/route.ts` (add `systemCommission: { total: number; savingsFees: number; loanShare: number }` summed from ledger rows with `party = 'platform'`), `src/lib/commission-history.ts` and its history route (events from the go-live date come from `CommissionLedger`, older events keep the reconstruction)
- Test: extend `tests/commission-history.test.ts`

**Interfaces:**
- Produces in `commission-history.ts`: `entriesFromLedger(rows: LedgerRow[]): CommissionEntry[]` mapping `savings` / `savings_catchup` / `loan` / `repayment` / `redemption_fee` to the existing `CommissionEntry` shape, with `source` mapped to the existing `CommissionSource` values (`savings`, `savings_catchup` map to a new `'savings'` member added to the union and to `COMMISSION_SOURCES`), and `mergeHistory(ledger: CommissionEntry[], reconstructed: CommissionEntry[], goLive: Date | null): CommissionEntry[]` that keeps reconstructed entries only when dated before `goLive` (all of them when `goLive` is null) and all ledger entries.

- [ ] **Step 1: Write failing tests:** `mergeHistory` drops reconstructed entries on or after go-live and keeps earlier ones; with `goLive` null keeps all reconstructed and no ledger; `entriesFromLedger` maps a `savings` row to source `'savings'` with the stored amount.
- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Wire the API and page** (PIN on rate save with the 10% cap error shown inline; penalty label; stat tile; history route uses `mergeHistory`). Remove the now-unused loan constants import from `commission-history.ts` by taking the rates as a parameter in `loanCommission(principal, rates)` and `repaymentCommission(amount, rates)`; update the existing tests accordingly.
- [ ] **Step 4: Browser check** (one dev server only; use the one already running on port 3000, do not start another): the page needs a super admin sign-in, so check what can be checked without one (type-check, tests) and ask the owner to open Commission, change a rate, enter the PIN, and confirm the "System commission" tile.
- [ ] **Step 5: Commit** `feat(commission): PIN-protected rate changes, system commission figure, ledger-backed history`.

---

### Task 8: Full check and rollout notes

**Files:** Create `docs/superpowers/plans/2026-11-03-commission-rollout.md` (short checklist)

- [ ] **Step 1: Run** every unit test file touched plus `tests/commission-history.test.ts`, then `npx tsc --noEmit` once and compare against the known errors (no new ones).
- [ ] **Step 2: Compare maths on three real-looking plans** with a throwaway script in the scratchpad that prints old fee vs new fee for a cash-daily ₦62,000, a bank-weekly ₦20,000 and a self plan, at default rates. Include the output in the rollout notes.
- [ ] **Step 3: Write the rollout checklist:** deploy dark (schema migration only changes tables); check no `commissionGoLive` row exists; agent and customer notice drafted; owner approves; run `scripts/commission-go-live.ts --now` on the server; watch the first deposits create ledger rows; in-flight redemptions keep `v1`.
- [ ] **Step 4: Commit** `docs: commission go-live checklist`. Do not deploy or run the go-live script: both need the owner's approval.
