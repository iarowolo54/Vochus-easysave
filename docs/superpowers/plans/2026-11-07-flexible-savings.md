# Flexible Savings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth plan type, Flexible (any amount, any day, chosen start/end ≥ 3 months), for cash and online customers, earning a commission/penalty at collection instead of a per-deposit fee.

**Architecture:** `cadence = 'flexible'` on the existing `SavingsPlan` (no migration). One new pure module `src/lib/flexible-savings.ts` owns settings, the term rule and the collection deduction; every fee and creation path branches on `isFlexible(cadence)` and calls it. Collection reuses the existing `collectionFee` → `EarlyRedemption.penalty/feeAgent` pipeline, so completion, ledger, token and payout code are untouched.

**Tech Stack:** Next 16 App Router route handlers, Prisma + SQLite, plain CSS, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-11-07-flexible-savings-design.md`

## Global Constraints

- No schema change, no migration, deploy without `ALLOW_DB_PUSH`.
- Defaults: `minTermMonths 3`, `minDeposit 100`, `cashCommissionPct 5`, `cashCommissionAgentPct 60`, `penaltyPct 5`, `penaltyAgentPct 40`. Guards: minTermMonths 1–60, minDeposit ≥ 0, cashCommissionPct ≤ 25, penaltyPct ≤ 25, agent shares 0–100.
- Setting key `flexibleSavings` in `PlatformSetting` (JSON). Admin edits need `requirePermission('commission', 'manage')` and `logAudit`.
- All money via `money()` / `pct()`; no inline rate maths in routes.
- Cash flexible: commission at collection, + penalty if early. Online flexible: penalty only if early. Online interest unchanged; cash earns none.
- Flexible never takes a per-deposit fee; `feeTaken = 0`, `feeCollected` untouched.
- Flexible refuses: auto-debit, catch-up, pay-ahead, bulk/several-days, paid-dates.
- No new `any`/`as any`; plain-words copy; every screen works at 360px.
- Work in a worktree: `./scripts/new-worktree.sh flexible-savings` (branch `feature/flexible-savings` off latest `main`). Stage only own files. Unit tests only (`npx tsx --test tests/<file>.test.ts`); never the `.int.test.ts` suite (writes local dev.db).

## Review Focus

1. **Redemption on the end date itself** — Lagos calendar day of `maturityDate` counts as matured, not early (customer would be wrongly charged the penalty). Test in Task 1.
2. **Missing/corrupt `flexibleSavings` row** — every field falls back to its default; never NaN deductions. Test in Task 1.
3. **Tiny balance** — deduction never exceeds balance; net payout never negative. Test in Task 1.
4. **Customer with a daily plan and a flexible plan** — saving with no `planId` is still refused as ambiguous; a flexible deposit never picks up daily-fee logic. Test in Task 2 (fee) and manual check in Task 7.
5. **Client sends `cadence: 'flexible'` plus `dailyAmount`/`periodDays`** — server ignores them and derives from dates; any other unknown cadence string is rejected (today it is stored as-is). Test in Task 1 (`resolveFlexiblePlan`) and a route check in Task 4.

---

### Task 1: `flexible-savings.ts` core

**Files:**
- Create: `src/lib/flexible-savings.ts`
- Test: `tests/flexible-savings.test.ts`

**Interfaces:**
- Produces:
  - `export const FLEXIBLE = 'flexible'`; `export function isFlexible(cadence: string | null | undefined): boolean`
  - `export const PLAN_CADENCES = ['daily','weekly','monthly','flexible'] as const`; `export function parseCadence(v: unknown): Cadence4 | null` (undefined/null/'' → 'daily'; unknown string → null)
  - `export interface FlexibleSettings { minTermMonths; minDeposit; cashCommissionPct; cashCommissionAgentPct; penaltyPct; penaltyAgentPct }` (all `number`), `DEFAULT_FLEXIBLE_SETTINGS`, `FLEXIBLE_SETTING_KEY = 'flexibleSavings'`
  - `parseFlexibleSettings(raw: unknown): FlexibleSettings` (field-by-field fallback, like `parseCommissionRates`)
  - `validateFlexibleSettings(raw: unknown): { ok: true; settings: FlexibleSettings } | { ok: false; error: string }`
  - `getFlexibleSettings(client: Pick<PrismaClient,'platformSetting'>): Promise<FlexibleSettings>` (never throws)
  - `resolveFlexiblePlan(input: { startDate: unknown; endDate: unknown }, s: FlexibleSettings, now?: Date): { startDate: Date; maturityDate: Date; periodDays: number } | { error: string }` — start via `resolvePlanStartDate`; end parsed with `parseDateInput`; end must be ≥ start + `minTermMonths` calendar months (month-end clamped, same rule as `addMonthsClamped` in `savings-interest.ts` — export that helper rather than copy it) and `periodDays ≤ MAX_PLAN_DAYS`. Errors: `Choose an end date.`, `A flexible plan must run at least ${n} months. Choose an end date on or after ${date}.`, `That end date is too far away.`
  - `isEarlyCollection(maturityDate: Date, at: Date): boolean` — true only when `at` is before the start of the Lagos (UTC+1) calendar day of `maturityDate`.
  - `flexibleDeduction(i: { source: string | null; balance: number; maturityDate: Date; at: Date }, s: FlexibleSettings): { commission: number; penalty: number; deduction: number; feeAgent: number; early: boolean }`
    - cash (`source !== 'self'`): `commission = pct(balance, cashCommissionPct)`; online: 0
    - `penalty = early ? pct(balance, penaltyPct) : 0`
    - `deduction = money(min(balance, commission + penalty))`; when capped, scale `feeAgent` by `deduction/(commission+penalty)`
    - `feeAgent = money(pct(commission, cashCommissionAgentPct) + pct(penalty, penaltyAgentPct))`

- [ ] **Step 1: Write failing tests** in `tests/flexible-savings.test.ts`:
  - `parseFlexibleSettings(null)` deep-equals defaults; `{ penaltyPct: 'x', minDeposit: 50 }` → defaults with `minDeposit 50`.
  - `validateFlexibleSettings` rejects `penaltyPct: 26`, `cashCommissionPct: 30`, `minTermMonths: 0`, `cashCommissionAgentPct: 101`; accepts defaults.
  - `parseCadence(undefined) === 'daily'`, `parseCadence('flexible') === 'flexible'`, `parseCadence('yearly') === null`.
  - `resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '2027-02-10' }, D)` ok, `periodDays === 92`; `endDate: '2027-02-09'` → error containing `at least 3 months`; start `2026-11-30` end `2027-02-28` ok (clamp); missing end → `Choose an end date.`
  - `flexibleDeduction` cash, early, balance 10000 → `{ commission: 500, penalty: 500, deduction: 1000, feeAgent: 500, early: true }`.
  - cash, matured → `{ commission: 500, penalty: 0, deduction: 500, feeAgent: 300 }`.
  - online, early, 10000 → `{ commission: 0, penalty: 500, deduction: 500, feeAgent: 200 }`; online matured → all 0.
  - collecting at 00:30 Lagos on the maturity day → `early === false`; 23:30 Lagos the day before → `early === true`.
  - settings with commission 25 + penalty 25 on balance 1 → `deduction ≤ 1` and `feeAgent ≤ deduction`.
- [ ] **Step 2:** `npx tsx --test tests/flexible-savings.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement the module per Interfaces.
- [ ] **Step 4:** Same command → all PASS; also `npx tsx --test tests/savings-interest*.test.ts` still PASS (helper export).
- [ ] **Step 5:** Commit `feat: flexible savings settings, term rule and collection deduction`.

### Task 2: Fee engine knows flexible

**Files:**
- Modify: `src/lib/savings-fee.ts` (`depositFee`, `settleUpFee`, `planFeePreview`, `feeSentence`)
- Modify: `src/lib/commission-ledger.ts` (`depositFeeOps`, `collectionFee`)
- Modify: `src/lib/wallet-rates.ts` (`savingsFeeRates`, `redemptionDeduction`) — flexible returns 0 rates (only the v1 pre-go-live path uses these; go-live is done, so this is a safety net)
- Test: `tests/savings-fee.test.ts`, `tests/commission-ledger.test.ts`

**Interfaces:**
- Consumes: `isFlexible`, `getFlexibleSettings`, `flexibleDeduction` (Task 1)
- Produces: `collectionFee(...)` signature unchanged; its `plan` arg gains `maturityDate: Date`. For flexible (post go-live) returns `{ feeRule: 'v2', penalty: d.deduction, feeAgent: d.feeAgent }` — **including online plans** (the current `source === 'self' → 0` early return must come after the flexible branch). `feeSentence` gains optional `flexible?: { cashCommissionPct: number; penaltyPct: number; online: boolean }`.

- [ ] **Step 1: Failing tests:** `depositFee({ cadence: 'flexible', dailyAmount: 0, feeCollected: 0, deposit: 2000 }, R)` → `{ fee: 0, agent: 0, platform: 0 }`; `settleUpFee` flexible → zero; existing daily/weekly/monthly tests unchanged. `feeSentence({ live: true, cadence: 'flexible', amountPerPayment: 0, periodicFeePct: 7.5, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: false } })` === `'5% is taken when they collect, plus 5% if they stop before the end date.'`; online variant === `'No charge if you keep it to the end date. Stopping early costs 5%.'`
- [ ] **Step 2:** `npx tsx --test tests/savings-fee.test.ts tests/commission-ledger.test.ts` → FAIL.
- [ ] **Step 3:** Add the flexible branch first in each function (before `isDaily`). In `collectionFee`, read the plan's `maturityDate` and `getFlexibleSettings`. Update the three callers (`api/transactions/redemption/request`, `api/customer/redeem`, `api/admin/early-redemption` + `preview`) to pass `maturityDate`.
- [ ] **Step 4:** Tests PASS; `npx tsc --noEmit` shows no new errors in touched files.
- [ ] **Step 5:** Commit `feat: flexible plans take no deposit fee; collection charges commission/penalty`.

### Task 3: Super admin settings

**Files:**
- Create: `src/app/api/admin/flexible-savings/route.ts` (GET: `requirePermission('commission','view')`; PUT: `'manage'`, `validateFlexibleSettings`, upsert `PlatformSetting`, `logAudit` with old→new values)
- Create: `src/app/api/flexible-savings/terms/route.ts` (GET for a signed-in agent or customer: returns `{ minTermMonths, minDeposit, cashCommissionPct, penaltyPct }` only; 401 otherwise)
- Modify: `src/app/superadmin/commission/page.tsx` — new "Flexible savings" card, same field/example pattern as the existing groups (e.g. "On ₦100,000 collected the commission is ₦5,000; the agent gets ₦3,000.")

**Interfaces:**
- Consumes: Task 1 settings functions.
- Produces: `GET /api/flexible-savings/terms` → `{ minTermMonths: number; minDeposit: number; cashCommissionPct: number; penaltyPct: number }` used by Tasks 6–7.

- [ ] **Step 1:** Implement both routes; return 400 with the validator's error.
- [ ] **Step 2:** Add the card; Save disabled while unchanged/saving; error and success states shown.
- [ ] **Step 3:** Browser check (super admin, local): load, change penalty to 6, save, reload shows 6, audit log has the entry; 26 is refused with the message. Check at 360px.
- [ ] **Step 4:** Commit `feat: super admin flexible savings settings`.

### Task 4: Creating flexible plans (server)

**Files (each create site gets the same branch):**
- `src/app/api/customers/route.ts` (main plan ~L190–245 and `plans[]` loop ~L269–285)
- `src/app/api/customers/plan/route.ts`
- `src/app/api/customer/enroll/route.ts` (main ~L122–156 and `plans[]` ~L172–193)
- `src/app/api/customer/plan/route.ts`

**Interfaces:**
- Consumes: `parseCadence`, `isFlexible`, `getFlexibleSettings`, `resolveFlexiblePlan`.
- Body for flexible: `{ cadence: 'flexible', startDate, endDate, goal }`; `dailyAmount`/`periodDays` ignored. Stored: `dailyAmount 0`, `periodDays`, `startDate`, `maturityDate` from `resolveFlexiblePlan`.

- [ ] **Step 1:** In each site: `const cad = parseCadence(body.cadence)`; null → 400 `Choose daily, weekly, monthly or flexible.`; flexible → `resolveFlexiblePlan`, error → 400; else existing path unchanged (amount checks no longer required for flexible).
- [ ] **Step 2:** Audit/email text: flexible shows `Flexible, <start> to <end>` instead of `₦X/daily x N days` (enrol confirmation email ~L236 too).
- [ ] **Step 3:** Manual check via the UI in Task 6 (no route-level unit tests exist for these files); `npx tsc --noEmit` clean for touched files.
- [ ] **Step 4:** Commit `feat: create flexible plans at registration and as a new plan`.

### Task 5: Deposits into flexible plans (server)

**Files:**
- `src/app/api/transactions/saving/route.ts` — flexible: skip `hasSavingOnDay`; refuse `amount < minDeposit` with `The smallest deposit is ₦${minDeposit}.`
- `src/app/api/transactions/saving/bulk/route.ts`, `src/app/api/transactions/saving/paid-dates/route.ts`, `src/app/api/customer/catchup/init/route.ts`, `src/app/api/customer/auto-debit/route.ts` (+ `verify`) — flexible → 400 `Flexible plans don't use set days.` / `Automatic saving isn't available on flexible plans.`
- `src/app/api/customer/transfer/init/route.ts` — flexible: minimum is `minDeposit` (replaces hardcoded ₦100 for that plan), `keys` refused
- `src/lib/auto-debit-run.ts`, `src/lib/pay-ahead.ts`, `src/lib/catchup.ts` — skip/refuse flexible as a second line of defence
- Test: `tests/saving-plan.test.ts` if a pure helper is added; otherwise manual

- [ ] **Step 1:** Add the branches. Read `getFlexibleSettings` once per request.
- [ ] **Step 2:** `grep -rn "cadence" src/lib/auto-debit*.ts src/lib/pay-ahead.ts src/lib/catchup.ts` — confirm no path assumes `dailyAmount > 0` for flexible (divide-by-zero / zero expected amount).
- [ ] **Step 3:** `npx tsc --noEmit` clean for touched files.
- [ ] **Step 4:** Commit `feat: any-amount deposits into flexible plans; schedule features refused`.

### Task 6: Creating flexible plans (screens)

**Files:**
- `src/app/dashboard/enrol/page.tsx` (cadence buttons ~L660, `Cadence` type L19, helpers L57/L64)
- `src/app/dashboard/add-plan/page.tsx` (~L145)
- `src/app/customer/enroll/page.tsx` (~L844, type L18)
- `src/app/customer/save/page.tsx` (the online new-plan form that posts to `/api/customer/plan`)
- Reuse: `DatePicker`, `src/components/ui/EndDateField.tsx`

- [ ] **Step 1:** Add a fourth button `Flexible`. When selected: hide amount and length fields; show Start date and End date; the end picker's earliest date = start + `minTermMonths` (from `/api/flexible-savings/terms`); show `feeSentence` flexible copy; post `{ cadence: 'flexible', startDate, endDate, goal }`.
- [ ] **Step 2:** Browser check at 360px with keyboard open: agent enrol a cash customer on Flexible; agent add a Flexible plan; online enrol on Flexible; online add a Flexible plan. Try an end date one day short → server message shown.
- [ ] **Step 3:** Commit `feat: flexible option on registration and new-plan screens`.

### Task 7: Saving and showing flexible plans (screens)

**Files (find all with `grep -rn "dailyAmount\|cadence" src/app src/components --include=*.tsx`; known):**
- `src/components/customer/SavingsCard.tsx`, `src/lib/savings-card.ts`, `src/components/customer/PlanEnded.tsx`, `src/components/customer/AutoFunding.tsx`
- `src/app/customer/dashboard/page.tsx`, `src/app/customer/save/page.tsx`, `src/app/customer/catchup/page.tsx`, `src/app/customer/redeem/page.tsx`, `src/app/customer/transactions/page.tsx`
- `src/app/dashboard/savings/page.tsx` (Record savings), `src/app/dashboard/customers/page.tsx`, `src/app/dashboard/redeem/page.tsx`, `src/components/agent/TodayRound.tsx`
- `src/app/superadmin/customers/page.tsx`, `src/app/superadmin/savings-monitor/page.tsx`, `src/app/superadmin/early-redemption/page.tsx`

- [ ] **Step 1:** Flexible plans: label `Flexible`; show `Saved ₦X · ends <date>` instead of `₦X daily`; no missed-days, next-due, catch-up, pay-ahead, several-days or auto-funding entry points; Record savings has an empty free amount field (no prefill, no one-a-day message); TodayRound excludes flexible plans from the expected list.
- [ ] **Step 2:** Redeem screens (agent and online) show the deduction line from the server for flexible: `Commission` and, if early, `Penalty for stopping early` — values from the request response, not recomputed client-side.
- [ ] **Step 3:** Browser check at 360px, both actors: record two cash deposits same day (₦250, ₦1,300); online transfer ₦150 into flexible; ₦50 refused; request an early collection → shows 5% + 5% (cash) / 5% (online); a customer with a daily + flexible plan sees both correctly.
- [ ] **Step 4:** Commit `feat: flexible plans on savings, redeem and admin screens`.

### Task 8: Final checks

- [ ] `npx tsx --test tests/flexible-savings.test.ts tests/savings-fee.test.ts tests/commission-ledger.test.ts tests/commission-rates.test.ts tests/saving-plan.test.ts` → all PASS.
- [ ] `npx tsc --noEmit` → no errors beyond the known baseline on `main`.
- [ ] Review the whole branch (code-reviewer + security-auditor checklist read myself: role checks on the admin route, settings validated server-side, no client-trusted amounts).
- [ ] Hand to the user for approval; merge onto latest `main`; deploy only with their approval (no `ALLOW_DB_PUSH`). Remove the worktree after merge.
