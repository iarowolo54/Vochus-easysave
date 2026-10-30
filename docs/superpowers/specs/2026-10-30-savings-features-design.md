# Design: Savings interest, identity uniqueness, weekly summaries

Date: 2026-10-30
Status: Draft for approval
Author: brainstormed with the project owner

This covers three independent client-requested features for Vochus EasySave.
They are separable and will ship as separate branches off latest `main`, but
features 1 and 3 share one new piece of infrastructure (a scheduled daily cron),
so they are designed together here. A fourth client item — "direct customer
account debit" — was deliberately deferred pending clarification from the client
and is **out of scope** for this document.

Stack reminder: Next.js App Router, Prisma + SQLite (`file:./dev.db`, hardcoded),
PM2 cluster (prod 2 instances, staging 1) on one SQLite file. Money fields are
`Float`; round with `money()` from `src/lib/wallet-guard.ts`. `AuditLog` is
append-only. SMS via KudiSMS only sends when `NODE_ENV=production`.

---

## Shared infrastructure: a daily cron

There is **no scheduler in this app today** (the `maturityNotified` field was
provisioned but never wired). Features 1 and 3 both need periodic work, so we
introduce exactly one scheduled entry point.

**Decision:** a single protected HTTP route, hit once per day by the server's
system `crontab` via `curl`.

- Route: `GET /api/cron/daily` (App Router handler).
- Auth: a bearer token compared against `process.env.CRON_SECRET` with
  `crypto.timingSafeEqual`. Missing/empty secret → fail closed (401), never a
  hardcoded fallback. No session; this is machine-to-machine.
- Runs inside the live Next server, so it has the Prisma client, env, and
  `NODE_ENV=production` (required for KudiSMS to actually send).
- Every day it: (a) accrues savings interest for active plans (Feature 1), and
  (b) if the day is Friday, sends weekly summaries (Feature 3).
- Idempotent: safe to run more than once a day. Interest accrual recomputes
  deterministically (see Feature 1); weekly summary dedupes per ISO week (see
  Feature 3).
- Returns a small JSON report (counts) and never throws out of the handler; a
  single customer's failure is caught and logged, the batch continues.

**Two one-time ops steps (deferred, handled after build):**
1. Set `CRON_SECRET` in prod + staging `.env` (owner edits `.env`; Claude cannot).
2. Add a daily `crontab` line on prod + staging calling the route with the secret.

Both are tracked as a handover checklist, not build steps. Until step 2 is done
the feature code is inert but correct; interest is computed deterministically at
the redemption **request** (below), so a late or missed cron never corrupts a
payout — the cron only drives the display figure.

---

## Feature 1 — 12% annual savings interest

### Intent / why
Reward customers for leaving money saved. Currently savings earn nothing and
early withdrawal is free and unrestricted, so "save to maturity" has no upside.
This adds 1% per completed month held, i.e. 12%/yr, as a bonus paid at redemption.

### Rules (confirmed with owner)
- **Every** savings plan earns **1% per completed month**, **simple** (no
  interest-on-interest) → 12%/yr.
- A "month" is a **monthly anniversary of the plan's `startDate`** (started the
  5th → earns on the 5th of each following month). Months without that day-of-month
  (e.g. anniversary would be the 31st) clamp to the **last day of that month**.
- The 1% each anniversary is applied to the **whole deposit principal** held at
  that moment — i.e. the sum of the plan's `type:'saving'`, `status:'Done'`
  transactions with `createdAt <= anniversary`. Principal only; previously
  accrued interest is **not** part of the base (keeps it simple 12%).
- **Only completed months count.** A partial final month before redemption earns
  nothing.
- **Accrual stops at `maturityDate`.** Anniversaries after maturity do not count;
  money left past maturity earns nothing extra.
- Interest is paid **on top** of the saved principal, released when the customer
  redeems.
- **Retroactive:** existing active plans backfill 1% for each month already
  completed since their `startDate` (the deterministic computation below does this
  automatically — no special migration script).

### Core computation (deterministic, idempotent)
A pure function in a new `src/lib/savings-interest.ts`, unit-tested first (TDD):

```
accruedInterest(startDate, maturityDate, deposits[], asOf):
  cutoff = min(asOf, maturityDate)
  anniversaries = [startDate+1mo, startDate+2mo, ...] while <= cutoff   # month-end clamped
  total = 0
  for each anniversary a:
    principalAtA = sum(d.amount for d in deposits if d.createdAt <= a)
    total += round1pct(principalAtA)          # money(principalAtA * 0.01)
  return money(total)
```

- `deposits` = the plan's `type:'saving'`, `status:'Done'` transactions
  (`amount`, `createdAt`). This is the authoritative base, not the mutable
  `balance` column.
- Deterministic from dates + ledger, so it is correct no matter when (or how
  often) the cron runs, and backfills existing plans for free.

### Persistence
- New column `SavingsPlan.interestAccrued Float @default(0)` (Prisma migration via
  `prisma migrate dev`; applies on deploy through `migrate deploy`). This is a
  **display figure only** — the running accrued interest the customer sees grow.
- The daily cron recomputes `SavingsPlan.interestAccrued` for each active plan and
  writes it, so the customer sees it grow without logging in.
- Note: a plan whose last anniversary falls on/before `maturityDate` must still get
  that final anniversary credited once; the cron keeps processing a plan until its
  accrual equals the maturity-capped total, then can skip it.

### Interest freezes at the redemption REQUEST (resolves the request-vs-payout gap)
Redemption is a multi-step pipeline (customer requests → token → agent approve →
super-admin approve + Paystack transfer → OTP finalize) and the money-moving steps
use a **frozen `netPayout` stored on the `EarlyRedemption` record**, not a fresh
computation. Interest therefore **freezes at the moment of the redemption request**
(the same moment `netPayout`/fee freeze today), confirmed with the owner.

- The customer `redeem` POST computes interest deterministically from the ledger
  as of "now" and **stores it on the `EarlyRedemption` record** in a new column
  `interestAmount Float @default(0)` (Prisma migration). It does NOT re-read the
  mutable `SavingsPlan.interestAccrued` (avoids a stale/racey display value driving
  money).
- Redemption payout becomes: **principal (`balance`) + `interestAmount` − fee**,
  where the fee is computed on **principal only** as today (interest is a bonus,
  not fee-bearing). `netPayout` stored on the record already includes the interest.
- Approval/finalize steps **do not recompute** — they pay out the frozen
  `netPayout`/`interestAmount` on the record. Update the `netPayout` computation in:
  - `src/app/api/customer/redeem/route.ts` (POST quote — adds interest, stores both),
  - the agent-direct path `src/app/api/transactions/redemption/route.ts` /
    `src/lib/redemption.ts` (compute + store at claim time),
  - super-admin approval `src/app/api/admin/early-redemption/[id]/route.ts` and its
    `finalize-otp` route read `record.interestAmount` (no recompute).
- **Accounting (must not be skipped):** interest is funded by the platform. Today
  the admin approve path debits `PlatformWallet` only by the *fee* — it must ALSO
  debit `PlatformWallet` by `record.interestAmount` in the same atomic
  `$transaction` as the payout, and write a `Transaction` row `type:'interest'`
  (amount = `interestAmount`, `agentId` = the plan's/customer's assigned agent,
  linked to the plan). Without this change interest would be paid with no platform
  debit — the stated anti-goal. (Builder: confirm exact PlatformWallet semantics
  against the existing Revenue credit.)
- Must stay race-safe and atomic per `database.md` (conditional updates, short txns).

### UI
- Customer plan view and the redemption breakdown show **accrued interest** as its
  own line (`src/app/customer/redeem/page.tsx` already renders a fee breakdown —
  add an interest line). Degrade gracefully on the `ui/zopa-standard` redesign:
  this is backend-first; if a redesigned screen lacks the line, the number is still
  correct in the API and at payout — tell the truth about any UI gap rather than
  faking it.

### Goals / non-goals / anti-goals
- Goal: correct, explainable, idempotent interest that matches the owner's worked
  example exactly.
- Non-goals: compounding; interest past maturity; per-deposit day-weighting;
  per-plan configurable rate (fixed 1%/month constant, named in one place).
- Anti-goal: any path where interest is credited twice, or paid without debiting the
  platform, or where a cron double-run inflates a payout.

### Left to the builder
- Exact `SavingsPlan` "done accruing" skip predicate; month-end clamp helper.
- Whether `type:'interest'` needs a new enum value or is a free string (schema uses
  free strings today).
- Confirm `PlatformWallet` debit semantics against existing Revenue credit code.

### Notes from the builder-check (my calls)
- **Base vs principal returned:** interest base is the deposit ledger (sum of
  `saving`/`Done`), authoritative. For an **active** plan `balance` equals deposited
  principal (fees are only taken at redemption), so in practice base == principal at
  request time; they diverge only after redemption when `balance → 0`, which is
  past the freeze point. No action needed — intentional.
- **`Transaction.agentId` on the interest row:** use the plan's/customer's assigned
  agent id (the row is for the audit trail / agent-facing reports).

---

## Feature 2 — one identity, one account

### Intent / why
Stop one person holding multiple accounts and stop a phone/email belonging to more
than one role. Today `Customer.phone`/`email` are **not unique**, the
agent-enrols-customer path does zero duplicate checks, and self-enrol checks phone
but not email. The prod audit found existing overlaps (see below).

### Rule (confirmed with owner)
- A phone number or an email may belong to **exactly one account across the entire
  system**, going forward. At every account-creation path, if the normalized phone
  **or** the email already exists on **any** account — Customer, Agent, SubAgent,
  SuperAdmin, StaffUser — reject with a clear "already registered" error (409).
- **Normalization before compare:** phone folded to canonical `0XXXXXXXXXX`
  (trim, strip spaces/dashes, `+234`/`234…` → `0`); email trimmed + lowercased
  (reuse `normalizeEmail` from `src/lib/email.ts`). **Store** customer email
  normalized going forward (today it is stored raw — a new `src/lib/phone.ts`
  `normalizePhone` helper is added and used on store + compare).
- **Existing violators are grandfathered** — left untouched, no deletions, no
  destructive migration. Enforcement is at the application layer (so no DB
  cross-table constraint is needed and no migration chokes on existing data). The
  check still blocks a grandfathered person from opening a *new* account.
- An **agent who wants to save** must open a customer account under a **separate**
  phone/email from their agent login.

### Prod audit (read-only, 2026-10-30) — informs grandfathering
34 customers, 15 agents, 2 sub-agents, 2 super-admins, 1 staff. Existing conflicts
(all grandfathered): 1 phone shared by 2 customers; 1 email shared by 2 customers;
4 phones shared between an Agent and a Customer; 1 email shared between an Agent and
a Customer. The agent/customer overlaps are agents who also save — exactly what the
new rule forbids going forward.

### Design
- New shared helper `assertIdentityAvailable({ phone?, email? }, { excludeAccountId? })`
  in `src/lib` that normalizes and queries all five account tables for either match
  and returns a structured conflict (or throws a typed error the routes map to 409).
- Call it at **every** creation path. Known paths:
  - `src/app/api/customers/route.ts` POST (agent enrols customer) — currently zero checks.
  - `src/app/api/customer/enroll/route.ts` POST and the invite variant — extend.
  - Agent registration route (locate during impl).
  - `src/app/api/subagents/route.ts` POST.
  - Staff/super-admin creation route(s) (locate during impl).
- **Matching against existing raw data (resolves the reviewer's leak concern):**
  existing rows are stored un-normalized (customer email stored raw today; phones
  may be `+234…`). A plain `where email = <lowercased>` uses SQLite's
  case-sensitive `=` and would MISS a grandfathered `John@X.com`, and `+234` phone
  forms can't be folded inside SQL. **Decision (my call):** given the tiny data set
  (≈34 customers, 15 agents, a handful else), the helper loads the candidate
  `id/phone/email` columns from the five account tables and compares **normalized in
  application code** (same `normalizePhone`/`normalizeEmail` on both sides). This is
  robust to raw storage with no destructive or reformatting migration. Customer
  email/phone are stored normalized **going forward**. (Scaling note: if an account
  table ever grows large, switch to a normalized indexed column + query; fine for
  now.)
- Keep the existing per-table DB uniques (Agent phone/email, SubAgent phone,
  SuperAdmin/Staff email) and the `P2002 → 409` catch as a backstop where they
  exist.
- **Residual race (my call — accepted):** `Customer.phone/email` have no DB unique
  (and one can't be added without first resolving the grandfathered duplicates,
  which the owner chose to leave). So two *simultaneous* customer enrolments with
  the same identity across the 2 PM2 instances could in principle both pass the
  app-check and insert. Accepted as a documented low risk: customer enrolment is
  already gated by an email OTP and/or an invite token (which serialize the flow),
  and volume is minimal. Cross-into Agent/SubAgent/Staff/SuperAdmin remains
  DB-safe via their existing uniques. If this ever matters, the fix is a dedicated
  normalized identity table — deferred.
- Error copy: "This phone number is already registered." / "This email is already
  registered." Do not reveal which role owns it (avoid enumeration).

### Goals / non-goals / anti-goals
- Goal: no new cross-role or duplicate account can be created; clear error.
- Non-goals: cleaning or merging existing duplicates; a DB-level cross-table
  constraint; blocking logins of grandfathered accounts.
- Anti-goal: a migration that fails on existing data, or deleting anyone's account.

### Left to the builder
- Locate and cover the agent-registration and staff/admin creation routes (the two
  not yet pinned); fail the task if any creation path is left unguarded.
- Whether to also normalize-on-store the customer **phone** (already `0…` form) or
  only compare — recommend store normalized for consistency.

---

## Feature 3 — weekly savings summary (email + SMS)

### Intent / why
Keep savers engaged with a weekly recap of their progress.

### Rules (confirmed with owner)
- **Recipients:** customers only.
- **Channels:** rich HTML **email** to any customer with an email on file; **SMS**
  only for customers with **no** email (one short GSM segment). Email primary, SMS
  fallback. (Client literally asked for both-to-everyone; owner chose
  email-primary/SMS-fallback to control cost — a known, intentional deviation to
  confirm with the client.)
- **Who:** only active savers — `Customer.status === 'Active'` **and** at least one
  active (not-yet-redeemed) savings plan.
- **Timing:** Friday ~4pm (the daily cron sends on Fridays), covering the 7 days
  ending that Friday.
- **Content:** amount saved this week (sum of `type:'saving'`,`status:'Done'`,
  `createdAt` in the window), current total balance across active plans, interest
  earned so far (Feature 1's `interestAccrued`), and progress to maturity / days
  left. SMS fallback example (≤160 chars): `Vochus: this week you saved NGN X.
  Balance NGN Y. Interest earned NGN Z. Keep saving! [date]`.

### Design
- Pure summary-builder function in `src/lib` (TDD): given a customer + their plans
  + this week's deposits → the numbers + rendered email HTML + SMS text. Unit-tested
  with no network.
- Sending wrappers reuse `sendMail` (`src/lib/mail.ts`) and `sendSMS`
  (`src/lib/kudisms.ts`); each send is fire-and-forget per customer, wrapped so one
  failure does not halt the batch.
- Reuse `emailLogo` (`src/lib/email-brand.ts`) in a small shared HTML wrapper.
- **Dedupe:** record each weekly send keyed by `(customerId, ISO-week)` so a
  re-fired cron can't double-send. Builder: a tiny `NotificationLog` table
  (`customerId, kind, periodKey, sentAt`, unique on `(customerId,kind,periodKey)`)
  is cleaner than overloading `AuditLog`; decide and note.
- Localize by `Customer.language` if cheap; otherwise English v1.

### Goals / non-goals / anti-goals
- Goal: one reliable weekly touch per active saver, cheap, no double-sends.
- Non-goals: opt-out/preferences UI (v1); agent summaries; rich SMS.
- Anti-goal: spamming inactive customers or paying for SMS to people who have email.

### Left to the builder
- `NotificationLog` vs `AuditLog` for the dedupe record.
- Exact weekly window boundaries (Fri-to-Fri) and timezone (server local).

---

## Cross-cutting constraints
- TDD throughout: pure logic (interest, summary) tested before wiring; `tsc`
  baseline must not regress; full suite green before staging.
- Ship order: each feature on its own branch off **latest `main`** (deploys ship the
  whole src tree, so same-base branches revert each other — base in order). Suggested
  order: Feature 2 (smallest, no infra) → Feature 1 (+ cron infra, money) →
  Feature 3 (reuses cron). Or 1+3 together since they share the cron.
- Do not disturb the `ui/zopa-standard` redesign; backend-first, degrade UI
  gracefully and state any gap honestly.
- No secrets/tokens/OTPs logged or returned. Prod deploys are UI-approval gated.
- Money movement (Feature 1 payout) gets a `security-auditor` pass before release.
