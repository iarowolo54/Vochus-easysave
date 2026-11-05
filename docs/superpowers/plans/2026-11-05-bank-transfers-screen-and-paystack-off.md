# Bank Transfers Screen, Agent Top-up by Transfer, Paystack Off

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Staff can see every Moniepoint transfer (customers and agents), credit held or missing payments by hand, and nothing in the product calls Paystack for payments or payouts any more.

**Architecture:** The transfer mechanism from `2026-11-04-moniepoint-transfer-deposits.md` is generalised from customers to agents (`PaymentIntent.actorType`). A new `bank-transfers` permission and super-admin screen list intents and held `BankAlert`s. Manual credits reuse the existing settle paths (`settleIntentPayment` for customers, new `settleAgentTransfer` for agents) so fee/ledger/coverage rules are not re-derived. Paystack code is disabled in groups, one commit each.

**Tech Stack:** Next 16 route handlers, Prisma/SQLite, node:test via tsx.

**Spec:** chat 2026-11-05. Decisions: agent top-up uses the same Moniepoint transfer; BVN lookup, bank list and account-name check (group D) stay for now; Paystack payments, auto-debit and Paystack payouts are switched off.

## Global Constraints

- Manual credit needs `bank-transfers:manage`, the approval PIN (`verifyApprovalPin`), a required note (3 to 300 chars), and an audit row naming the admin.
- Staff cannot change the amount. A request is credited at its own amount; a held alert at the alert's amount.
- Never credit twice: a request is credited only while `status = Pending`; an alert only while `status = Unmatched`; both flips are conditional updates.
- Status words: Paid, Waiting, Not paid, Needs review, Credited by hand.
- Plain CSS, existing `admin-ui` components, no emoji icons, works at 360px.
- Do not edit committed migrations; add one.

## Review Focus

- Two staff crediting the same row at once credits once.
- A late alert for a request already credited by hand lands in Needs review and can be dismissed, not double-credited.
- A staff member without `bank-transfers:manage`, or with a wrong PIN, cannot credit.
- Agent top-up never credits a customer plan and vice versa.
- Switching Paystack off leaves the app building and the Save, Withdraw and Redeem screens showing a clear message, not an error.

## Tasks

### Task 1: Schema and permission
- [ ] Migration: `BankAlert.resolvedAt/resolvedBy/resolvedNote`; `PaymentIntent.manualBy/manualNote`.
- [ ] `permissions.ts`: screen `bank-transfers` (Money group, view+manage, handlesMoney, manageNote "Credit a transfer by hand"); nav item in `AdminShell.tsx`.
- [ ] Update permission tests if they count screens.

### Task 2: Generalise transfer intents to agents
- [ ] `transfer-intent.ts`: `createTransferIntent` takes `{ actor: { customerId } | { agentId }, planId?, baseAmount }`; one open transfer per actor.
- [ ] `agent-settle.ts`: `settleAgentTransfer(client, intent, reference, amount, via)` consumes the intent, creates `wallet_funding` Transaction (method `Transfer`), increments `walletBalance`.
- [ ] `moniepoint-poll.ts`: dispatch settle by `intent.actorType`.
- [ ] Routes `api/agent/transfer/init` and `status`; shared `TransferPanel` component; `dashboard/wallet` uses it.

### Task 3: Manual credit library
- [ ] `src/lib/manual-credit.ts`: `creditRequestByHand`, `creditAlertByHand`, `dismissAlert`, each conditional-update guarded and audited.
- [ ] Pure `transferRowStatus(row, now)` with unit tests.

### Task 4: Admin API and screen
- [ ] `GET api/admin/bank-transfers`, `GET .../people`, `POST .../credit-request`, `.../credit-alert`, `.../dismiss-alert`.
- [ ] `/superadmin/bank-transfers` page: counts, status filter, search, table, three action dialogs.

### Task 5: Paystack off, one group per commit
- [ ] A. Money in: customer/agent/catch-up init+verify routes and both webhooks return 410 "no longer available"; client callers hidden or switched to transfer.
- [ ] B. Auto-debit: stop the cron pass, hide the UI, init/verify/cancel return 410.
- [ ] C. Money out: payout mode forced Manual, Paystack transfer calls skipped.
- [ ] D. Left alone: BVN lookup, bank list, account-name check.

### Task 6: Verify and deploy
- [ ] Unit tests, `tsc`, one integration pass on local dev.db, browser check of the screen, deploy only on the user's go.
