# Weekly Savings Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Friday, send each active saver one weekly recap — rich email if they have an email, else a short SMS — with no double-sends.

**Architecture:** A pure summary-builder renders the numbers + email HTML + SMS text from a customer's plans and this week's deposits. An orchestration function finds active savers, dedupes per ISO-week via a new `NotificationLog` table, and sends (email-primary / SMS-fallback), fire-and-forget per customer. The existing daily cron calls it only on Fridays.

**Tech Stack:** Next.js App Router cron route, Prisma + SQLite, `sendMail` (`src/lib/mail.ts`), `sendSMS` (`src/lib/kudisms.ts`), `emailLogo` (`src/lib/email-brand.ts`), `money()` (`src/lib/wallet-guard.ts`).

**Spec:** `docs/superpowers/specs/2026-10-30-savings-features-design.md` (Feature 3 section)

## Global Constraints
- Recipients are **customers only**. An active saver = `Customer.status === 'Active'` AND at least one savings plan with `status === 'Active'`.
- Channel: **email if `Customer.email` is present**, else **SMS** to `Customer.phone`. Never both. A customer with neither email nor phone is skipped silently.
- **Dedupe:** at most one summary per customer per ISO-week. A re-fired cron the same Friday must not double-send.
- Money rounded with `money()`. No new `any`/`as any`. Keep `npx tsc --noEmit` at its 23-error baseline.
- The senders only actually transmit under `NODE_ENV==='production'` (`sendSMS` enforces; `sendMail` — confirm, and gate the email call the same way if it does not). Tests must not require live sending.
- Migrations forward-only, one per schema change, per `docs/migration-baseline.md`.
- node:test runs files as parallel processes against one dev.db — scope every test's rows by a unique run id and clean up only its own rows (no table-wide `deleteMany({})`).
- SMS body is one GSM segment: **≤ 160 characters**, plain ASCII.

## Review Focus
- **Customer with no email AND no phone** → skipped, no send, no crash. → Task 3.
- **Re-fired cron on the same Friday** → each customer gets exactly one send (dedupe on `(customerId, 'weekly_summary', ISO-week)`). → Tasks 1 & 3.
- **Inactive customer, or active customer with zero active plans** → excluded. → Task 3.
- **One customer's send throwing** (bad address, SMS gateway error) → the batch continues for everyone else. → Task 3.
- **SMS exceeding 160 chars** when amounts are large → the builder must keep it within one segment. → Task 2.

---

### Task 1: `NotificationLog` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_notification_log/migration.sql`
- Test: `tests/notification-log.int.test.ts`

**Interfaces:**
- Produces model `NotificationLog { id String @id @default(cuid()); customerId String; kind String; periodKey String; sentAt DateTime @default(now()); @@unique([customerId, kind, periodKey]) }`. Accessor `prisma.notificationLog`.

- [ ] **Step 1: Write the failing test** — create a Customer+Agent, then `prisma.notificationLog.create({ customerId, kind:'weekly_summary', periodKey:'2026-W44' })`; assert it reads back; assert a second create with the same `(customerId, kind, periodKey)` rejects with `P2002`. Scope by run id; clean up by id.
- [ ] **Step 2: Run it, verify it fails** (`prisma.notificationLog` undefined).
- [ ] **Step 3: Add the model**, `npx prisma migrate dev --name add_notification_log` (additive CREATE TABLE + unique index), `npx prisma generate`. Commit the migration.
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(weekly-summary): NotificationLog schema + migration`.

---

### Task 2: Weekly window + summary builder (pure)

**Files:**
- Create: `src/lib/weekly-summary.ts`
- Test: `tests/weekly-summary.test.ts`

**Interfaces:**
- Produces:
  - `isoWeekKey(d: Date): string` — e.g. `2026-W44` (ISO-8601 week, UTC).
  - `weekWindow(asOf: Date): { start: Date; end: Date }` — the 7-day window ending at `asOf` (end = asOf, start = asOf − 7 days).
  - `buildWeeklySummary(input: { firstName: string; plans: { balance: number; maturityDate: Date; interestAccrued: number; status: string }[]; weekDeposits: { amount: number }[]; asOf: Date }): { savedThisWeek: number; totalBalance: number; interestEarned: number; emailHtml: string; smsText: string }` — `savedThisWeek` = `money(sum(weekDeposits.amount))`; `totalBalance` = `money(sum of active plans' balance)`; `interestEarned` = `money(sum of active plans' interestAccrued)`. `emailHtml` includes the logo (`emailLogo()` from `@/lib/email-brand`) and the three figures + nearest days-to-maturity. `smsText` ≤160 ASCII chars, matching the spec example `Vochus: this week you saved NGN X. Balance NGN Y. Interest earned NGN Z. Keep saving!`.

- [ ] **Step 1: Write the failing test** — assertions:
  - `isoWeekKey(d(2026,10,30))` returns the correct `YYYY-Www` (compute the expected value).
  - `buildWeeklySummary` with 2 active plans (balances 1000+500) + one inactive plan, weekDeposits [200,100], interestAccrued [10,5] → `savedThisWeek===300`, `totalBalance===1500`, `interestEarned===15`; `smsText.length <= 160`; `emailHtml` contains the three formatted amounts.
  - A large-number case (balance 9_999_999) still yields `smsText.length <= 160`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement.** Format money with the app's existing naira formatting (match `formatNaira`/`money` usage in `src/lib`); keep the SMS to one segment (use compact `NGN 1,234` forms, trim words if needed).
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(weekly-summary): weekly window + summary builder`.

---

### Task 3: Recipient query, dedupe, and send orchestration

**Files:**
- Create: `src/lib/weekly-summary-run.ts`
- Test: `tests/weekly-summary-run.int.test.ts`

**Interfaces:**
- Consumes: `buildWeeklySummary`, `isoWeekKey`, `weekWindow` (Task 2); `sendMail` (`@/lib/mail`), `sendSMS` (`@/lib/kudisms`); `prisma`; `NotificationLog` (Task 1).
- Produces: `sendWeeklySummaries(client, now: Date, opts?: { customerIds?: string[] }): Promise<{ emailed: number; smsed: number; skipped: number; failed: number }>`:
  - Select active savers: `Customer.status==='Active'` with `savingsPlans: { some: { status:'Active' } }` (optionally narrowed to `opts.customerIds` for tests). Load each customer's active plans + this week's `type:'saving'`,`status:'Done'` deposits (`createdAt` within `weekWindow(now)`).
  - `periodKey = isoWeekKey(now)`. Skip a customer who already has a `NotificationLog` for `(customerId,'weekly_summary',periodKey)` (dedupe). Create the `NotificationLog` row BEFORE/at send so a concurrent/re-fired run can't double-send (rely on the unique constraint: attempt the log insert first; on `P2002` skip).
  - Build the summary; if `customer.email` → `sendMail`; else if `customer.phone` → `sendSMS`; else skip. Each send wrapped so one failure increments `failed` and continues (never throws out).
  - Return counts.

- [ ] **Step 1: Write the failing test** — seed: an active customer WITH email + an active plan + a deposit this week; an active customer with NO email but a phone; an active customer with neither; an INACTIVE customer; an active customer with only a redeemed plan. Stub `sendMail`/`sendSMS` via the `require_.cache` override (as `tests/auto-debit-failure.int.test.ts` does) and set `NODE_ENV` as needed. Assert: the email customer got one `sendMail`; the no-email customer got one `sendSMS`; the neither/inactive/no-active-plan customers got nothing; a NotificationLog row exists per sent customer; a SECOND `sendWeeklySummaries` same week sends nothing (dedupe); a throwing `sendMail` for one customer still lets the others send (counts reflect it).
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(weekly-summary): recipient query + dedupe + send orchestration`.

---

### Task 4: Cron Friday wiring

**Files:**
- Modify: `src/app/api/cron/daily/route.ts`
- Test: `tests/weekly-summary-cron.int.test.ts`

**Interfaces:**
- Consumes: `sendWeeklySummaries` (Task 3).
- Produces: in the cron `GET`, after the existing passes, if `now` is a **Friday** (server-local `getDay()===5`), call `sendWeeklySummaries(prisma, now)` in its own try/catch and fold `{ emailed, smsed, summarySkipped, summaryFailed }` into the JSON report. Replace the `// SEAM (Feature 3)` comment. Non-Friday → do not send.

- [ ] **Step 1: Write the failing test** — call the two-pass function path by exercising `sendWeeklySummaries` directly for the Friday logic is covered in Task 3; here, test the cron gate: build a request with a valid `CRON_SECRET` bearer and assert that the summary counts appear in the JSON only when `now` is a Friday. (If mocking `now` in the handler is impractical, extract a tiny `isSummaryDay(now)` helper and unit-test that, and assert the handler calls `sendWeeklySummaries` only when it returns true — a scoped `opts.customerIds` keeps it from touching other rows.) Keep existing cron behavior (interest + auto-debit passes) intact.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(weekly-summary): send weekly summaries on Fridays via daily cron`.

---

## Ops (handover, same as Features 1/direct-debit)
- Requires the daily `crontab` + `CRON_SECRET` already needed by Feature 1 / direct-debit. No new infra.
- SMS only transmits under `NODE_ENV=production`; confirm `sendMail` does likewise (Task 2/3 gate it if not).
