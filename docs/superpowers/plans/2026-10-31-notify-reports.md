# Redemption-Approval Emails + Per-Agent Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** (A) email the superadmins when a customer's redemption is awaiting approval; (B) give superadmins a downloadable per-agent report (CSV).

## Design (owner decisions 2026-10-31)
- **A recipients:** all `SuperAdmin` accounts that have an `email` (StaffUser sign-in is deferred, so staff aren't approvers yet). Best-effort, never blocks/throws into the redemption flow; only actually transmits under `NODE_ENV==='production'` (gate like the other senders).
- **A trigger:** once, when the early-redemption record is CREATED (enters awaiting-approval). Not per state change.
- **B metrics (per agent):** customers count; funds under management (sum of `balance` over the agent's customers' `status:'Active'` plans); active-plans count; commission (the agent's current `commissionBalance`); overdue savers (active-plan customers whose latest Done `saving` is 3+ whole days ago in Africa/Lagos, or never).
- **B format:** CSV download (text/csv, Content-Disposition attachment). A formatted PDF is a possible follow-up, not built now.

## Global Constraints
- `requireSuperAdmin` (role) on the report route. No secret/PII beyond what a superadmin report needs; never log emails/secrets. Money via `money()`. No new `any`. Keep `npx tsc --noEmit` at the 23-error baseline. `AuditLog` append-only.
- Email via `sendMail` (`src/lib/mail.ts`); the send must be wrapped so it can NEVER throw into the caller, and gated on `NODE_ENV==='production'` (mirror the weekly-summary pause-notify pattern in `src/lib/auto-debit-failure.ts`).
- Reuse the Lagos-day + overdue definition already used for item 24 / `src/lib/customer-type.ts` where applicable; avoid N+1 (use `groupBy`/aggregates).
- Tests: `NEXTAUTH_SECRET=test PAYSTACK_SECRET_KEY=sk_test_x PAYSTACK_WEBHOOK_SECRET=whsec_test npx tsx --test tests/<file>`. node:test parallel on one dev.db — scope rows by a unique run id, clean up by id only, $disconnect. Mock superadmin session like `tests/savings-interest-admin.int.test.ts`; stub `sendMail` via the `require_.cache` pattern in `tests/auto-debit-failure.int.test.ts`.

## Review Focus
- The redemption email must NEVER block or fail a redemption request (best-effort). → T1.
- No customer PII/secret leaked into logs; the email body carries only what's needed. → T1.
- The report route is superadmin-only and computes correct per-agent aggregates without N+1. → T2.

---

### Task 1: Redemption awaiting-approval email (Feature A)
**Files:** Create `src/lib/redemption-notify.ts`; modify the route(s) that CREATE the early-redemption/awaiting-approval record; Test `tests/redemption-notify.int.test.ts`.
**Find the creation point(s) first:** grep `earlyRedemption.create` across `src/app/api` (candidates: `src/app/api/customer/redeem/route.ts`, `src/app/api/transactions/redemption/request/route.ts`). Hook the notification at each place a NEW awaiting-approval record is created (after the record is committed).
**Produces:** `notifySuperAdminsRedemptionPending(client, input: { customerName: string; amountNaira: number; planGoal?: string; ref: string }): Promise<void>` — loads all `SuperAdmin` rows with a non-empty `email`, and for each sends a plain email (subject e.g. "Redemption awaiting approval", body naming the customer, amount (formatNaira), plan, ref, and that it needs approval). Entirely wrapped in try/catch so it can never throw; `sendMail` only actually sends under `NODE_ENV==='production'` (gate it). No secret/auth data; safe to call fire-and-forget (`.catch(()=>{})`) from the route.

- [ ] Step 1: failing int test — stub `sendMail`; seed 2 SuperAdmins (one with email, one without) + a customer; call `notifySuperAdminsRedemptionPending(...)` under `NODE_ENV=production` → `sendMail` called once (only the admin with an email), with the amount/ref in the body and NO secret; under non-production → not sent; a throwing `sendMail` does not throw out. (Plus: exercise the route hook — creating a redemption request triggers the notify — if feasible without heavy setup; else unit-test the lib + assert the route calls it.)
- [ ] Step 2–4: fail → implement (lib + route hook, fire-and-forget) → pass.
- [ ] Step 5: commit `feat(notify): email superadmins when a redemption awaits approval`.

### Task 2: Per-agent report CSV (Feature B)
**Files:** Create `src/app/api/admin/reports/agents/route.ts` (GET); optionally a small `src/lib/agent-report.ts` for the aggregation; Test `tests/agent-report.int.test.ts`.
**Produces:** `GET /api/admin/reports/agents` (requireSuperAdmin) → `text/csv` with `Content-Disposition: attachment; filename="agent-report-<date>.csv"`. One row per agent with columns: agentId, name, customersCount, fundsUnderManagement, activePlansCount, commissionBalance, overdueSaversCount. Compute with grouped queries (not per-agent loops): customers via `customer.groupBy({ by:['agentId'] })`; funds + active plans via a `savingsPlan` aggregate/groupBy joined through the customer's agent (status 'Active'); overdue via one `transaction.groupBy(_max.createdAt)` over active-plan customers, then the 3-day Lagos rule. `money()` on naira; round/format cleanly for CSV. Escape CSV fields (commas/quotes/newlines in agent names).

- [ ] Step 1: failing int test — seed an agent + 2 customers with active plans (known balances) + deposits (one recent, one 4 days old) → GET returns `text/csv` (assert content-type + attachment header) whose row for that agent has the right customersCount, fundsUnderManagement (money), activePlansCount, commissionBalance, and overdueSaversCount; a non-superadmin → 403. Scope seeded rows by run id and assert on that agent's row only.
- [ ] Step 2–4: fail → implement → pass.
- [ ] Step 5: commit `feat(reports): superadmin per-agent CSV report`.

## Notes
- PDF format deferred (CSV chosen). Admin UI needs a "Download report" button pointing at the endpoint — flag to the UI side (not built here).
