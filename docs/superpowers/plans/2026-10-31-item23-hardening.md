# Item-23 / Hardening Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Close the owner-approved remainder of `docs/backend-handoff.md` item 23 + two carried fixes (finalize-otp atomicity, non-reusable-card ₦50 credit), via small independent route/schema changes.

**Spec:** `docs/backend-handoff.md` (item 23 bullets) is authoritative for most tasks; each task names its files + acceptance. Rules: `.claude/rules/auth-security.md`, `backend-api.md`, `database.md`.

## Global Constraints
- Admin routes require superadmin (role, not bare session). Own-the-data checks. Money races → conditional `updateMany` + `count` check inside `$transaction`, never read-then-write. Money via `money()`.
- Secrets/PII/base64 never returned or logged. `AuditLog` append-only. No new `any`. Keep `npx tsc --noEmit` at the 23-error baseline. Migrations forward-only/additive.
- Tests: `NEXTAUTH_SECRET=test PAYSTACK_SECRET_KEY=sk_test_x PAYSTACK_WEBHOOK_SECRET=whsec_test npx tsx --test tests/<file>`. node:test parallel on one dev.db — scope rows by a unique run id, clean up by id only, $disconnect. Mock superadmin session like `tests/savings-interest-admin.int.test.ts`; customer session like `tests/customer-me-interest.int.test.ts`.
- Reuse the existing helpers already added in the prior batch: `adminActor(session)` (real audit actor), `isValidAmount` (`@/lib/wallet-guard`), the conditional-claim pattern.

## Review Focus
- A second finalize-otp (double OTP submit / two admins) must not finalize/pay twice. → T1.
- The ₦50 enroll charge on a non-reusable card must be credited exactly once (idempotent) and never double with the mandate path. → T2.
- A superadmin role check stays on every admin route touched. → T3,T4,T5,T6,T7,T8.
- Server paging must NOT silently truncate existing callers (backward-compatible default). → T8.

---

### Task 1: finalize-otp atomic claims (money)
**Files:** `src/app/api/admin/agent-withdrawal/[id]/finalize-otp/route.ts`, `src/app/api/admin/early-redemption/[id]/finalize-otp/route.ts`; Test `tests/finalize-otp-races.int.test.ts`.
These finalize a payout after an OTP and still read-then-write. Apply the same claim-before-pay pattern as the approve routes: a conditional `updateMany` on the record's current (pre-finalize) status/flag, `count`-checked, BEFORE any Paystack finalize/credit; loser → 409, no money moved; multi-row in `$transaction`. Keep the OTP check + attempt limits + requireSuperAdmin + logAudit.
- [ ] TDD: failing test — two sequential/concurrent finalize calls on one record → exactly one finalize/credit, second 409, balances/transaction-count prove single payment. Watch fail → implement → pass. Commit `fix(handoff): atomic finalize-otp for withdrawal + redemption`.

### Task 2: non-reusable card → credit the ₦50 to savings
**Files:** `src/app/api/customer/auto-debit/verify/route.ts`; Test extend `tests/auto-debit-verify.int.test.ts`.
On a verified-success enrollment charge whose `authorization.reusable === false`: DO NOT create a mandate, but DO credit the ₦50 to the plan as a normal `saving` Transaction (idempotent on the enrollment ref, same atomic consume-intent path already there) and return `200 { active:false, savedInstead:true }` (auto-debit not set up; the ₦50 was saved). A reusable card still creates the mandate + credits ₦50 as before.
- [ ] TDD: failing test — non-reusable authorization → no `AutoDebitMandate` row, exactly one ₦50 `saving` Transaction credited to the plan, response flags auto-debit not set up; replay stays one credit; reusable path unchanged. Commit `feat(direct-debit): credit the enroll charge to savings when the card is non-reusable`.

### Task 3: real-actor audit on remaining routes + rewards validation + wallets floatLimit (batched)
**Files:** the admin routes still hardcoding `actorName:'SuperAdmin'` (agents create/status/profile-lock/unblock/activate/resend-verification; `wallets/capital-to-float`, `wallets/inject-capital`, `wallets/commission-payout`; `admin/set-approval-pin`), `src/app/api/admin/rewards/[id]/route.ts`, `src/app/api/admin/wallets/route.ts`; Test `tests/admin-hardening-batch.int.test.ts`.
- Replace hardcoded `'SuperAdmin'` with `adminActor(session)` (real id+name) on each. (If a route isn't superadmin-gated but staff/other, use the correct session actor.)
- Rewards PATCH: validate `startDate` parses and numeric fields (`offlineRewardAmount` etc.) are finite numbers → 400 on bad; add an audit entry on reward change.
- `admin/wallets` GET: include `floatLimit` in each agent-wallet row (the page shows "—" without it).
- [ ] TDD: per fix, one assertion (a touched route's audit row carries the real actorId/name; rewards bad-date/NaN → 400; wallets rows include floatLimit). Commit `fix(handoff): real audit actors, rewards validation, wallets floatLimit`.

### Task 4: inject-capital writes a ledger row
**Files:** `src/app/api/admin/wallets/inject-capital/route.ts`; Test `tests/inject-capital.int.test.ts`.
Currently the `reference` is ignored and no Transaction is written. Validate `amount` (`isValidAmount`), store the reference, write a `Transaction` (type e.g. `capital_injection`, the ref, amount, method `Admin`, status `Done`) and `logAudit` with `adminActor`, inside a `$transaction` with the Float increment. requireSuperAdmin.
- [ ] TDD: failing test — injecting capital increments Float, writes exactly one `capital_injection` Transaction carrying the reference, audits the real admin; bad amount → 400. Commit `fix(handoff): inject-capital writes a ledger row + audit`.

### Task 5: interest-rates maxAmount + per-term on/off
**Files:** `prisma/schema.prisma` (add to `model InterestRate`: `maxAmount Float?`, `enabled Boolean @default(true)`), a migration, `src/app/api/admin/interest-rates/route.ts`; Test `tests/interest-rates.int.test.ts`.
Additive migration (`npx prisma migrate dev --name interest_rate_max_enabled`). GET returns `maxAmount`+`enabled`; POST accepts and persists them (validate `maxAmount` finite ≥0 when present; `enabled` boolean). Keep requireSuperAdmin. Do NOT change loan-eligibility logic in this task (just store/return the fields) unless a consumer already reads them — if loan logic should honor `enabled`/`maxAmount`, note it for a follow-up rather than guessing.
- [ ] TDD: failing test — POST with maxAmount+enabled persists and GET returns them; a disabled term round-trips `enabled:false`; bad maxAmount → 400. Commit `feat(handoff): interest-rate maxAmount + enabled toggle`.

### Task 6: early-redemption GET pending/isEarly fix
**Files:** `src/app/api/admin/early-redemption/route.ts` (GET); Test `tests/early-redemption-list.int.test.ts`.
Per item 23: the `pending` count must include `AwaitingOTP` (and the other awaiting states it should), and `isEarly` must reflect whether the redemption is before the plan's `maturityDate` (not always true). requireSuperAdmin.
- [ ] TDD: failing test — a redemption in `AwaitingOTP` is counted pending; a redemption of a matured plan has `isEarly:false`, an early one `isEarly:true`. Commit `fix(handoff): early-redemption pending count + isEarly`.

### Task 7: loan-repayments timezone + loan-disbursements disbursed date
**Files:** `src/app/api/admin/loan-repayments/route.ts`, `src/app/api/admin/loan-disbursements/route.ts`; Test `tests/loan-reports.int.test.ts`.
- loan-repayments: make the date filter use the same timezone basis as "today" (Africa/Lagos, consistent with the rest of the app) rather than UTC midnight vs server-local; don't load every repayment purely for totals if avoidable (aggregate) — but correctness of the date window is the priority.
- loan-disbursements: return a real disbursed date (the disbursement timestamp) instead of the request date; the page currently shows the request date labelled "Requested".
- [ ] TDD: failing test — a repayment on a boundary day is included/excluded per Lagos dates; a disbursed loan's row carries its disbursed date distinct from the request date. Commit `fix(handoff): loan-repayments tz + loan-disbursements disbursed date`.

### Task 8: server paging on admin transactions + audit (backward-compatible)
**Files:** `src/app/api/admin/transactions/route.ts`, `src/app/api/admin/audit/route.ts`; Test `tests/admin-paging.int.test.ts`.
Add optional `?page` + `?limit` with a sane max, and return `{ rows, total }` (or keep the existing array shape but ALSO accept paging) so existing callers that send no params behave as today (just no longer hard-capped silently — return the first page + a `total`). Do NOT break the current UI: default with no params = current behavior + a `total`. requireSuperAdmin. Flag in the report that the admin UI should add pagination controls to use `?page`.
- [ ] TDD: failing test — `?page=2&limit=10` returns the right slice + correct `total`; no params returns a first page + total without erroring; requireSuperAdmin enforced. Commit `feat(handoff): server paging for admin transactions + audit (backward-compatible)`.

## Notes
- Deferred (owner): staff sign-in & roles; card-code storage. Not in this plan.
- The admin UI needs follow-up for T8 paging controls (flag to the UI side).
