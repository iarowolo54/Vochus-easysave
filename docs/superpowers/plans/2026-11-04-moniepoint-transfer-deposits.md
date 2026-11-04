# Moniepoint Transfer Deposits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Customers save by bank transfer to one Moniepoint account; a Gmail reader confirms the credit alert and credits the plan.

**Architecture:** A transfer deposit is a `PaymentIntent` whose `amount` is a unique-kobo figure (e.g. ₦13,000.37) with an expiry. A poller reads Moniepoint credit alerts over IMAP (read-only), verifies sender and Gmail's SPF/DKIM/DMARC result, parses them, and matches exact amount + time window to exactly one open intent, then calls the existing `settleIntentPayment`. Anything else becomes an Unmatched `BankAlert` plus a `payment_needs_manual_review` audit row. Nothing is credited on a guess.

**Tech Stack:** Next 16 route handlers, Prisma/SQLite, `imapflow` + `mailparser`, node:test via tsx.

**Spec:** the brainstorm in chat (2026-11-04). Scope: customer "save into plan" only. Agent/wallet Paystack, catch-up, pay-ahead and auto-debit are untouched.

## Global Constraints

- Window: an intent is open for 30 minutes; match on the alert's own transaction time, with 5 minutes of grace after expiry.
- Exact amount only (to the kobo, compared with `money()`); the full unique amount is credited to the plan.
- Alert trusted only if From matches `MONIEPOINT_SENDER` AND Gmail's `Authentication-Results` shows `dkim=pass` and `dmarc=pass` (or `spf=pass`) for that sender's domain.
- One alert credits once: `BankAlert.messageId` and `BankAlert.txnId` are unique.
- Secrets only from env via `requireEnv`: `IMAP_USER`, `IMAP_APP_PASSWORD`, `MONIEPOINT_SENDER`, `MONIEPOINT_ACCOUNT_NUMBER`, `MONIEPOINT_ACCOUNT_NAME`, plus existing `CRON_SECRET`. No literal fallbacks, nothing logged.
- Mailbox opened read-only; never modify or delete mail.
- Plain-words UI, works at 360px, no emoji icons.

## Review Focus

- Two open intents never share an amount (allocation inside a transaction; 99 slots, then "try again shortly").
- Same alert polled twice credits once (messageId/txnId unique).
- Alert from a forged sender or without DKIM/DMARC pass is ignored.
- Wrong amount, late transfer, or two matches → Unmatched, not credited.
- Forwarded/duplicated body (as in the sample .eml) still parses once.

## File Structure

- `prisma/schema.prisma` + new migration: `PaymentIntent` gains `method`, `expiresAt`; new `BankAlert`.
- `src/lib/moniepoint-alert.ts`: pure `parseMoniepointAlert`, `isAuthenticAlert`.
- `src/lib/transfer-intent.ts`: pure `pickUniqueKobo`, `matchAlertToIntent`; `createTransferIntent` (db).
- `src/lib/moniepoint-poll.ts`: IMAP read + process (db), `pollMoniepointAlerts()`.
- `src/lib/cron-auth.ts`: shared bearer check (extracted from `api/cron/daily`).
- `src/app/api/cron/bank-alerts/route.ts`, `src/app/api/customer/transfer/init/route.ts`, `.../status/route.ts`.
- `src/lib/customer-settle.ts`: allow `via: 'Moniepoint transfer'`.
- `src/app/customer/save/transfer-panel.tsx` + `page.tsx` `pay()`.
- Tests: `tests/moniepoint-alert.test.ts`, `tests/transfer-intent.test.ts`.

### Task 1: Alert parser and authenticity check

**Interfaces:** Produces `parseMoniepointAlert(text: string): ParsedAlert | null` where `ParsedAlert = { amount: number; senderName: string; narration: string; txnId: string; at: Date }`; `isAuthenticAlert(from: string, authResults: string[], expectedSender: string): boolean`.

- [ ] Write tests with the real sample text (amount 13,000.00, txnId `38476235933`, at `2026-11-02T18:52:45Z` since 07:52:45 PM is Lagos UTC+1 → 18:52:45Z; duplicated body parses once; non-alert text → null; forged From → false; missing dkim=pass → false).
- [ ] Run `npx tsx --test tests/moniepoint-alert.test.ts` → FAIL.
- [ ] Implement in `src/lib/moniepoint-alert.ts` (strip HTML, regex fields, txnId = last digit run in narration before `|`).
- [ ] Run → PASS.

### Task 2: Unique amount and matching

**Interfaces:** Produces `pickUniqueKobo(base: number, taken: number[]): number | null`, `matchAlertToIntent(alert: {amount:number; at:Date}, intents: OpenIntent[]): OpenIntent | 'none' | 'ambiguous'`, `TRANSFER_WINDOW_MS`, `TRANSFER_GRACE_MS`.

- [ ] Tests: first free kobo 01..99; none free → null; match inside window; outside window / wrong amount → 'none'; two same amount → 'ambiguous'.
- [ ] Run → FAIL; implement `src/lib/transfer-intent.ts` pure parts; run → PASS.

### Task 3: Schema

- [ ] Add `PaymentIntent.method String @default("paystack")`, `expiresAt DateTime?`; model `BankAlert { id, messageId @unique, txnId @unique, amount, senderName, narration, alertAt, status ("Matched"|"Unmatched"), intentRef?, createdAt }`.
- [ ] `npx prisma migrate dev --name add_bank_transfer_intents` then `npx prisma generate`. Verify migration SQL is additive only.

### Task 4: Poller

**Interfaces:** Consumes Tasks 1–3, `settleIntentPayment`. Produces `pollMoniepointAlerts(): Promise<{ scanned: number; credited: number; unmatched: number }>`.

- [ ] Install `imapflow mailparser @types/mailparser`.
- [ ] Extend `settleIntentPayment` `via` with `'Moniepoint transfer'` (method `Transfer`, channel `bank_transfer`, system actor name from `via`).
- [ ] Implement `src/lib/moniepoint-poll.ts`: read-only INBOX, search from `MONIEPOINT_SENDER` since 2 days ago, skip known `messageId`, verify, parse, match, settle or record Unmatched + `REVIEW_ACTION` audit. Throttle on-demand calls to once per 10 s.

### Task 5: Routes

- [ ] Extract `authorized(req)` to `src/lib/cron-auth.ts`; use in `api/cron/daily` and new `api/cron/bank-alerts`.
- [ ] `POST /api/customer/transfer/init`: customer session; same plan/ended/open-redemption checks as paystack init; min ₦100; allocate unique kobo in a transaction; return `{ ref, payAmount, expiresAt, account: { bank, number, name } }`.
- [ ] `GET /api/customer/transfer/status?ref=`: owner-scoped intent; if Pending, run throttled poll; return `pending | done | expired | review` (+ `newBalance` on done).

### Task 6: UI

- [ ] `transfer-panel.tsx`: account details with copy buttons, big exact amount with copy, warning "Send exactly ₦X. A different amount can't be matched automatically.", countdown, polls status every 5 s, states: waiting / confirmed / expired / needs review.
- [ ] `page.tsx` `pay()` calls transfer init and shows the panel instead of redirecting.

### Task 7: Verify

- [ ] Unit tests pass; `npx tsc --noEmit` shows no new errors in touched files; manual browser check of the panel once env is set.
