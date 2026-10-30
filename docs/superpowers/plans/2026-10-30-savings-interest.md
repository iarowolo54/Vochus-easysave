# 12% Annual Savings Interest (online plans, configurable) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Online savings plans (`source === 'self'`) earn, per completed month held, `annualRate/12` of the deposit principal (default 12%/yr, simple). The annual rate is superadmin-configurable and applied **forward-only** (each month earns at the rate in effect when it completed). Interest is computed deterministically from the deposit ledger + the rate history, shown to the customer, frozen at the redemption request, and paid on top of principal out of the platform wallet.

**Architecture:** A pure `accruedInterest` function computes interest from `startDate`, `maturityDate`, the plan's `saving` deposit ledger, and a **rate schedule** (effective-dated annual rates) as of a given instant — each monthly anniversary uses the rate in effect on that anniversary (`rateOn`, default 12 when none precedes it). The rate schedule is an append-only `SavingsInterestRate` history edited by the superadmin (mirroring `commissionRates`). A DB wrapper gates on `source === 'self'` and loads deposits + schedule. A daily cron persists a display figure (`SavingsPlan.interestAccrued`). At the redemption **request** the interest is computed once and frozen on `EarlyRedemption.interestAmount`; every payout path pays `balance + interestAmount − fee` and debits the platform wallet by the interest, writing a `type:'interest'` ledger row.

**Tech Stack:** Next.js App Router, Prisma + SQLite, `node:test` via `tsx` (`NEXTAUTH_SECRET=test npx tsx --test tests/<file>`).

**Spec:** `docs/superpowers/specs/2026-10-30-savings-features-design.md` (Feature 1 + "Shared infrastructure: a daily cron").

## Global Constraints

- **Scope gate (invariant at EVERY path):** interest applies ONLY to `SavingsPlan.source === 'self'`. For `source === 'agent'`: interest is `0`, nothing stored on `interestAmount`/`interestAccrued`, no interest ledger row, no platform debit — identical to today.
- **Configurable rate, FORWARD-ONLY:** the annual rate comes from the `SavingsInterestRate` history. For a given anniversary date `a`, the applicable annual rate is the latest history entry with `effectiveFrom <= a`, else the baseline **12**. A rate change (new entry, `effectiveFrom = now`) affects only anniversaries `>= now`; already-completed months keep their rate. The monthly fraction is `annual / 12 / 100`.
- **Simple, not compounding:** each completed month earns `money(principalAtAnniversary * monthlyFraction)`, where principal = sum of `type:'saving'`,`status:'Done'` `amount` with `createdAt <= anniversary` (never on prior interest).
- **Anniversaries** are monthly from `startDate`, day-of-month clamped to the month's last day; only anniversaries `<= min(asOf, maturityDate)` count (accrual stops at maturity; partial final month earns nothing). Deposit `createdAt` may be backdated — base is by `createdAt`.
- **Money:** `Float`; round every figure with `money()` from `src/lib/wallet-guard.ts`. Fee is on principal only (interest is not fee-bearing).
- **Freeze at request:** `customer/redeem` POST and the agent-direct path compute interest once and store it; approve/finalize READ `EarlyRedemption.interestAmount`, never recompute.
- **Atomic money:** interest debit + ledger row go inside the SAME existing `$transaction` as the payout. `Transaction.agentId` is required → interest row uses the customer's agent. `Transaction.ref` is `@unique` → interest row ref is `` `${record.ref}-INT` ``. `AuditLog` append-only. Keep SQLite transactions short.
- **Authz:** only the superadmin may read/change the rate (reuse the existing `requireSuperAdmin` guard used by `api/admin/commission/rates`).
- No new `any`/`as any`; ES modules. `npx tsc --noEmit` must not regress the **23-error baseline**. Base branch off latest `main` (`d33a9de`). Don't disturb `ui/zopa-standard`.

## Review Focus

- **`source === 'agent'` at every path** (accrual, redeem POST, approve, finalize, agent-direct, UI) → 0, no row/debit. Most important; one missed gate pays an offline plan. (Tasks 4, 6, 7, 8, 9.)
- **Forward-only rate change:** a month that completed BEFORE a rate change keeps the old rate; a month completing AFTER uses the new rate; with an empty history everything is 12%. (Task 2 tests with a `rateSchedule`.)
- **Backdated deposit** counts at the correct anniversary base. (Task 2.)
- **Month-end clamp** (Jan 31 start → Feb 28/29, Mar 31…). (Task 2.)
- **Past-maturity plan:** accrual stops at `maturityDate`; cron idempotent; payout uses capped figure. (Tasks 2, 5.)
- **Rate authz:** a non-superadmin cannot change the rate. (Task 9.)

---

### Task 1: Schema — interest columns + rate-history model + migration

**Files:**
- Modify: `prisma/schema.prisma` (`SavingsPlan`, `EarlyRedemption`, + new `SavingsInterestRate`)
- Create: generated migration under `prisma/migrations/`

**Interfaces:**
- Produces: `SavingsPlan.interestAccrued Float @default(0)`; `EarlyRedemption.interestAmount Float @default(0)`; and
  ```prisma
  model SavingsInterestRate {
    id            String   @id @default(cuid())
    annualRate    Float
    effectiveFrom DateTime @default(now())
    createdBy     String?
    createdAt     DateTime @default(now())
  }
  ```

- [ ] **Step 1: Edit schema** — add the two columns and the `SavingsInterestRate` model above.
- [ ] **Step 2: Migrate** — `npx prisma migrate dev --name add_savings_interest` (all additive; non-destructive).
- [ ] **Step 3: Verify** — `npx prisma migrate status` applied; `npx tsc --noEmit` at 23; full suite (`NEXTAUTH_SECRET=test npx tsx --test tests/*.test.ts tests/*.int.test.ts`) green (149).
- [ ] **Step 4: Commit** — `feat(interest): add interest columns + SavingsInterestRate history model`

---

### Task 2: Pure `accruedInterest` + `rateOn`

**Files:**
- Create: `src/lib/savings-interest.ts`
- Test: `tests/savings-interest.test.ts`

**Interfaces:**
- Produces:
  - `rateOn(schedule: { effectiveFrom: Date; annualRate: number }[], date: Date): number` — annualRate of the latest entry with `effectiveFrom <= date`, else `DEFAULT_ANNUAL_RATE = 12`. Export `DEFAULT_ANNUAL_RATE`.
  - `accruedInterest(input: { startDate: Date; maturityDate: Date; deposits: { amount: number; createdAt: Date }[]; asOf: Date; rateSchedule: { effectiveFrom: Date; annualRate: number }[] }): number` — per the spec pseudo-code: for each anniversary `a <= min(asOf, maturityDate)`, add `money(principalAtA * (rateOn(rateSchedule, a) / 12 / 100))`; return `money(total)`. Month-end clamp via a local `addMonthsClamped`.

- [ ] **Step 1: Write the failing tests** in `tests/savings-interest.test.ts`:
  - `empty schedule → 12% baseline` (one completed month, 31000 principal → 310).
  - `two completed months, simple` (base excludes prior interest).
  - `forward-only rate change` — schedule `[{effectiveFrom: afterMonth1, annualRate: 24}]`: month 1 (anniversary before the change) stays 12% (→1%), month 2 (anniversary after) uses 24% (→2%). Assert each month's contribution.
  - `rate change exactly on an anniversary` — `effectiveFrom === anniversary a` applies to `a` (boundary: `<=`).
  - `backdated deposit counts at the earlier anniversary`.
  - `accrual stops at maturity`; `partial final month earns nothing`.
  - `month-end clamp` (Jan 31 start across a Feb).
- [ ] **Step 2: Run → fail** (`NEXTAUTH_SECRET=test npx tsx --test tests/savings-interest.test.ts`).
- [ ] **Step 3: Implement** `rateOn`, `DEFAULT_ANNUAL_RATE`, `addMonthsClamped`, `accruedInterest` using `money` from `@/lib/wallet-guard`.
- [ ] **Step 4: Run → pass**; full suite green.
- [ ] **Step 5: Commit** — `feat(interest): pure accruedInterest calculator with forward-only rate schedule`

---

### Task 3: Rate store (read the schedule, append a new rate)

**Files:**
- Create: `src/lib/savings-interest-rate.ts`
- Test: `tests/savings-interest-rate.int.test.ts`

**Interfaces:**
- Consumes: Prisma client (passed in), `DEFAULT_ANNUAL_RATE` (Task 2).
- Produces:
  - `getSavingsRateSchedule(client): Promise<{ effectiveFrom: Date; annualRate: number }[]>` — all `SavingsInterestRate` rows sorted by `effectiveFrom` ascending (may be empty).
  - `getCurrentSavingsRate(client): Promise<number>` — `rateOn(schedule, now)` for display (so an empty history returns 12).
  - `appendSavingsRate(client, annualRate: number, createdBy?: string): Promise<void>` — inserts a row with `effectiveFrom = new Date()`; validates `annualRate` is a finite number `>= 0` (throw a typed error otherwise).

- [ ] **Step 1: Write the failing integration test** `tests/savings-interest-rate.int.test.ts`:
  - empty table → `getCurrentSavingsRate` returns `12`; `getSavingsRateSchedule` returns `[]`.
  - after `appendSavingsRate(…, 10)` → current is `10`; schedule has one entry with `effectiveFrom <= now`.
  - two appends in order → schedule sorted ascending; `rateOn` at a past date before any entry still returns 12.
  - `appendSavingsRate(…, -5)` and `appendSavingsRate(…, NaN)` throw.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the three functions. Clean up rows the test creates.
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): add savings interest-rate store (schedule + append)`

---

### Task 4: `accruedInterestForPlan` DB wrapper (source-gated)

**Files:**
- Modify: `src/lib/savings-interest.ts`
- Test: `tests/savings-interest-plan.int.test.ts`

**Interfaces:**
- Consumes: `accruedInterest` (Task 2), `getSavingsRateSchedule` (Task 3), Prisma client.
- Produces: `accruedInterestForPlan(client, plan: { id: string; source: string; startDate: Date; maturityDate: Date }, asOf: Date): Promise<number>` — returns `0` when `plan.source !== 'self'`; else loads the plan's `type:'saving'`,`status:'Done'` deposits (`amount, createdAt`) + the rate schedule and returns `accruedInterest({...})`.

- [ ] **Step 1: Write the failing integration test** `tests/savings-interest-plan.int.test.ts`:
  - `source:'self'` plan + backdated deposits + a mid-stream rate change → matches a hand-computed forward-only value.
  - `source:'agent'` plan, identical data → **0**.
  - a non-`saving` ledger row is excluded from the base.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** (early-return 0 for non-self; query only `amount, createdAt`).
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): add source-gated accruedInterestForPlan wrapper`

---

### Task 5: Daily cron route + accrual pass

**Files:**
- Create: `src/app/api/cron/daily/route.ts`
- Test: `tests/cron-daily-interest.int.test.ts`

**Interfaces:**
- Consumes: `accruedInterestForPlan` (Task 4).
- Produces: `GET /api/cron/daily` — `CRON_SECRET` bearer (timingSafeEqual, fail closed on unset/empty/mismatch); for each active `source:'self'` plan, persist `interestAccrued = accruedInterestForPlan(…, now)`; returns `{ accrued: <count> }`. (Feature 3 later extends this route for Friday summaries — leave a seam, build no summaries now.)

- [ ] **Step 1: Write the failing integration test** `tests/cron-daily-interest.int.test.ts`:
  - unset/empty `CRON_SECRET` or wrong bearer → **401** (no hardcoded fallback; wrong-length token must not throw).
  - correct bearer → 200; a seeded active `source:'self'` plan has `interestAccrued` persisted to the expected value; a `source:'agent'` plan stays `0`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** (read env; equal-length `timingSafeEqual`; load active `source:'self'` plans; per-plan try/catch; `savingsPlan.update`).
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): daily cron accrues interestAccrued for online plans`

---

### Task 6: Freeze interest at the redemption request (`customer/redeem` POST)

**Files:**
- Modify: `src/app/api/customer/redeem/route.ts` (fee/netPayout/create ~81–109, response ~135)
- Test: `tests/redeem-interest-freeze.int.test.ts`

**Interfaces:**
- Consumes: `accruedInterestForPlan` (Task 4), `money`.

- [ ] **Step 1: Write the failing integration test** (customer `customer_token` JWT auth, mint like other customer-route tests):
  - `source:'self'` plan, one completed month → created `EarlyRedemption.interestAmount` = expected; `netPayout === money(balance − deduction + interestAmount)`; response includes `interest`.
  - `source:'agent'` plan → `interestAmount === 0`; `netPayout === money(balance − deduction)`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — `const interest = await accruedInterestForPlan(prisma, plan, now)`; `netPayout = money(plan.balance - deduction + interest)`; add `interestAmount: interest` to the create; add `interest` to the response.
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): freeze accrued interest on the redemption request`

---

### Task 7: Pay interest at admin approve + OTP finalize

**Files:**
- Modify: `src/app/api/admin/early-redemption/[id]/route.ts` (approve `$transaction` ~141–186)
- Modify: `src/app/api/admin/early-redemption/[id]/finalize-otp/route.ts` (`$transaction` ~49–84)
- Create: `src/lib/redemption-interest-ops.ts` (shared ops-builder helper)
- Test: `tests/early-redemption-interest.int.test.ts`

**Interfaces:**
- Consumes: `EarlyRedemption.interestAmount` (frozen, Task 6).
- Produces: `interestPayoutOps(prisma, record, agentId, customerId): PrismaPromise[]` — returns `[]` when `record.interestAmount <= 0`; else `[platformWallet.upsert Revenue decrement interestAmount, transaction.create type:'interest' ref \`${record.ref}-INT\` amount:interestAmount agentId customerId planId]`.

**Note on testing:** these routes are superadmin + PIN gated (bank path calls Paystack, stubbed off-prod). Test the extracted `interestPayoutOps` helper directly (deterministic, no PIN flow) for both `interestAmount > 0` and `=== 0`; verify the two call sites splice it into their existing `$transaction` arrays by inspection + tsc + staging smoke. State this honestly in the report.

- [ ] **Step 1: Write the failing test** `tests/early-redemption-interest.int.test.ts` against `interestPayoutOps`: with `interestAmount = X > 0`, executing the returned ops decrements `PlatformWallet` Revenue by `X` and writes a `Transaction` `type:'interest'`, `amount:X`, `ref:${ref}-INT`, `agentId`/`customerId`/`planId` set; with `0`, returns `[]` (no row, no debit).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `interestPayoutOps` and splice `...interestPayoutOps(prisma, record, agentId, customerId)` into BOTH `$transaction` arrays (approve + finalize-otp). Do NOT change `record.netPayout` (already includes interest from Task 6).
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): platform debit + interest ledger row at approval and OTP finalize`

---

### Task 8: Agent-direct redemption path

**Files:**
- Modify: `src/app/api/transactions/redemption/route.ts` (compute ~29–35, `$transaction` ~43–74)
- Test: `tests/redemption-agent-interest.int.test.ts`

**Interfaces:**
- Consumes: `accruedInterestForPlan` (Task 4), `interestPayoutOps`-style ledger write (Task 7 helper; this path has no frozen record so compute live then build the same ops shape).

- [ ] **Step 1: Write the failing test**: `source:'self'` plan via this path → `netPayout = money(gross − platformFee − agentComm + interest)`, Revenue decremented by `interest`, a `type:'interest'` row (`${ref}-INT`); `source:'agent'` plan unchanged (no interest). Mirror `redemption.int.test.ts`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — `const interest = await accruedInterestForPlan(prisma, plan, new Date())`; add to `netPayout`; inside the existing `$transaction`, when `interest > 0`, add the Revenue decrement + `type:'interest'` Transaction (reuse the Task 7 helper, passing a live-built record-like `{ ref, interestAmount: interest, savingsPlanId: plan.id }`). Keep the `claimPlanForRedemption` idempotency guard.
- [ ] **Step 4: Run → pass**; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): pay interest on the agent-direct redemption path`

---

### Task 9: Superadmin rate configuration (API + editor)

**Files:**
- Create: `src/app/api/admin/savings-interest/route.ts` (GET + POST, superadmin-gated)
- Modify: a superadmin editor — add a "Savings interest rate" card to `src/app/superadmin/commission/page.tsx` (the existing rates editor) OR a sibling page; mirror the commission-rates UI
- Test: `tests/savings-interest-admin.int.test.ts` (mirror however `api/admin/commission/rates` is tested)

**Interfaces:**
- Consumes: `getCurrentSavingsRate`, `getSavingsRateSchedule`, `appendSavingsRate` (Task 3), `requireSuperAdmin` (same guard as `api/admin/commission/rates`).

- [ ] **Step 1: Write the failing test** `tests/savings-interest-admin.int.test.ts`: GET returns the current rate (12 when empty) + history; POST with a valid rate (superadmin) appends an entry and the new rate becomes current; POST as a **non-superadmin** → 403 (reuse the auth pattern the commission route test uses); POST an invalid rate (negative/NaN) → 400.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the route (mirror `src/app/api/admin/commission/rates/route.ts`: `requireSuperAdmin`, GET reads store, POST validates + `appendSavingsRate`, records `createdBy`). Add the editor UI to the superadmin commission page: show current rate + a short history list + a "Set new rate (%/yr)" form that POSTs; match the page's existing plain-CSS style and mobile width; handle loading/empty/error states.
- [ ] **Step 4: Verify** — target test green; `npm run build` ok; full suite green; tsc baseline.
- [ ] **Step 5: Commit** — `feat(interest): superadmin-configurable annual savings rate (forward-only)`

---

### Task 10: Display accrued / earned interest

**Files:**
- Modify: `src/app/customer/redeem/page.tsx` (breakdown ~256–260, local fee math ~167–180, types ~16–22)
- Modify: `src/app/customer/dashboard/page.tsx` (balance facts ~254–266)
- Modify: `src/app/dashboard/redeem/page.tsx` (agent breakdown ~463–464)
- Test: none automated (client components; build + manual/staging). State honestly.

**Interfaces:**
- Consumes: the `interest` field from the redeem quote (Task 6) and `SavingsPlan.interestAccrued` (Task 5) via the feeding endpoint (`/api/customer/me` etc. — add the field to its `select` if missing; never add blob columns).

- [ ] **Step 1: Confirm the data path** feeds `interestAccrued` + the quote `interest`; add to the `select`/response if missing.
- [ ] **Step 2: Add the display** — customer redeem breakdown `Interest earned +₦X` line (and include it in the client-side `netPayout` preview so it matches the server); customer dashboard "interest so far" fact; agent redeem interest line. For `source:'agent'` plans the value is 0 — render ₦0 or omit consistently. Match existing styles; mobile width; loading/empty/error states.
- [ ] **Step 3: Verify** — `npm run build` ok; `npx tsc --noEmit` baseline; full suite green.
- [ ] **Step 4: Commit** — `feat(interest): show accrued/earned interest in customer and agent views`

---

## Rollout (after all tasks, not a build step)
- One migration ships (`add_savings_interest`) — applies on deploy via `prisma migrate deploy`.
- **Two one-time ops steps (deferred, coordinate with owner):** set `CRON_SECRET` in prod + staging `.env`; add a daily `crontab` line hitting `/api/cron/daily` with the bearer. Until then, `interestAccrued` won't auto-refresh for display, but **payouts stay correct** (interest is computed fresh at the redemption request).
- Default rate is 12%/yr with an empty history; the superadmin can change it from the editor (forward-only) once deployed.
- Deploy staging → smoke (a `source:'self'` plan shows interest and redeems with interest in net payout + an `interest` ledger row + platform debit; change the rate in the admin editor and confirm only future months move; a `source:'agent'` plan shows/pays none) → prod (owner UI approval) → merge to `main`.
