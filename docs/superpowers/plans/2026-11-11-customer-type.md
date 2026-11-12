# Customer Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each customer's type (online/offline) at registration and block plan creation across the line.

**Architecture:** A `Customer.type` column is backfilled with today's derived rule, so the deploy changes no labels. `src/lib/customer-type.ts` becomes the single place for the type's pure rules. The two plan-creation routes call one guard. Every reader of `customerType(plans)` switches to the stored field. Money rules keep reading `plan.source`.

**Tech Stack:** Next 16 App Router, Prisma + SQLite, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-11-11-customer-type-design.md`

## Global Constraints

- Type values are exactly `'online' | 'offline'`. Any other stored value is read as `'offline'`.
- The migration is forward-only and new. Its backfill: `UPDATE "Customer" SET "type" = 'online' WHERE "id" IN (SELECT "customerId" FROM "SavingsPlan" WHERE "source" = 'self');`
- Block copy, verbatim:
  - customer: `Your plans are set up by your agent. Please ask them to open a new plan for you.`
  - agent: `This customer saves on the app. They open their own plans.`
- Both blocks return HTTP 403 and are enforced on the server. The UI only hides buttons.
- No `plan.source` money check is edited.
- No new `any`. Run unit tests only (`npx tsx --test tests/<file>.test.ts`); never the `.int.` tests.
- Stage only this plan's files. The tree holds other sessions' uncommitted work.

## Review Focus

- A stored type other than `'online'`/`'offline'`, or null, must behave as offline and never crash. Tested in Task 1.
- An offline customer on `/customer/save` with all plans ended: the screen must not offer "Start a new plan". It points them to their agent instead. Checked in Task 3 at 360px.
- The agent add-plan customer picker must not offer online customers, and the server still refuses a hand-built request. Tested in Task 3 by the tripwire, and checked at 360px.
- An Ajo payout to an online member must create a `self` plan, and to an offline member an `agent` plan, from the stored type. Tested in Task 1 (`planSourceFor`).
- Deploy must not change any label: online count = customers with a `self` plan. Checked in Task 4.

---

### Task 1: Pure type rules

**Files:**
- Modify: `src/lib/customer-type.ts`
- Test: `tests/customer-type.test.ts`

**Interfaces:**
- Produces:
  - `type CustomerType = 'online' | 'offline'`
  - `asCustomerType(v: unknown): CustomerType`
  - `planSourceFor(t: CustomerType): 'self' | 'agent'`
  - `planCreationBlock(by: 'customer' | 'agent', t: CustomerType): string | null` returns the verbatim block copy, or null when allowed
  - `lastPaidAtOf` is unchanged.
- `customerType(plans)` is deleted in Task 3, once nothing calls it.

- [ ] **Step 1: Write failing tests.** Add them alongside the existing ones:
  - `asCustomerType('online') === 'online'`; `'offline'`, `null`, `undefined`, `'Online'` and `'x'` all give `'offline'`.
  - `planSourceFor('online') === 'self'` and `planSourceFor('offline') === 'agent'`.
  - `planCreationBlock('customer','offline')` equals the customer copy, `planCreationBlock('agent','online')` equals the agent copy, and the other two combinations give `null`.
- [ ] **Step 2:** Run `npx tsx --test tests/customer-type.test.ts`. Expect FAIL (not exported).
- [ ] **Step 3:** Implement the three functions in `src/lib/customer-type.ts`.
- [ ] **Step 4:** Rerun. Expect PASS.
- [ ] **Step 5:** Commit: `feat: pure customer-type rules (stored type, plan guard, ajo plan source)`.

### Task 2: Column, migration, set at creation

**Files:**
- Modify: `prisma/schema.prisma` (`Customer`: `type String @default("offline")`, with a `///` doc line: "online = registered themselves; offline = registered by an agent. Set once at creation.")
- Create: `prisma/migrations/<timestamp>_customer_type/migration.sql`
- Modify: `src/app/api/customer/enroll/route.ts:155` (`type: 'online'`)
- Modify: `src/lib/customer-request.ts:241` (`type: 'offline'`)

- [ ] **Step 1:** Check that the dev server's Prisma client points at this tree's DB (see `worktree-shared-prisma-client`). Then run `npx prisma migrate dev --create-only --name customer_type`.
- [ ] **Step 2:** Append the backfill UPDATE from Global Constraints to the generated `migration.sql`. Then run `npx prisma migrate dev` to apply it.
- [ ] **Step 3:** Set `type` explicitly in both create calls.
- [ ] **Step 4:** Run `sqlite3 prisma/dev.db "SELECT type, COUNT(*) FROM Customer GROUP BY type"`. Expect the online count to equal `SELECT COUNT(DISTINCT customerId) FROM SavingsPlan WHERE source='self'`.
- [ ] **Step 5:** Commit: `feat: store customer type at registration; backfill keeps today's labels`.

### Task 3: Guards and readers

**Files:**
- Modify: `src/app/api/customer/plan/route.ts`. After loading the customer, call `planCreationBlock('customer', asCustomerType(customer.type))` and return 403 if it's set.
- Modify: `src/app/api/customers/plan/route.ts`. After the owned-customer lookup, call `planCreationBlock('agent', …)` and return 403 if it's set.
- Modify, replacing `customerType(x.savingsPlans)` with `asCustomerType(x.type)` and dropping the `savingsPlans` selects that only fed it:
  - `src/app/api/customers/route.ts` (lines 46-47 and 159 become `type: 'online'` / `type: 'offline'` filters)
  - `src/app/api/admin/customers/route.ts`
  - `src/lib/ajo-server.ts`
  - `src/app/api/agent/ajo/[id]/members/route.ts`
  - `src/app/api/agent/redemption/[id]/route.ts`
  - `src/app/api/admin/early-redemption/[id]/route.ts`
  - `src/lib/ajo-settle.ts` (`createAjoPlan` takes `type: CustomerType`, and `source: planSourceFor(type)`)
  - `src/lib/payout-notify.ts`
- Modify: `src/app/superadmin/customers/page.tsx:416`. The plan "Type" row shows the customer's type.
- Modify: `src/app/api/customer/me/route.ts` to return `type`. Then:
  - `src/app/customer/save/page.tsx` hides "Start a new plan" (lines 274 and 388) for offline customers, and changes the line-270 text to: "It can’t take more savings. Redeem it, or ask your agent to open a new plan."
- Modify: `src/app/dashboard/add-plan/page.tsx` and `src/app/dashboard/savings/page.tsx`. Online customers aren't offered for "add plan". If one is reached, show the agent copy.
- Delete: `customerType(plans)` from `src/lib/customer-type.ts`, and its two old tests.
- Test: `tests/plan-creation-guard.test.ts`, a tripwire in the style of `tests/sms-sites.test.ts`. It reads both plan routes and asserts each contains `planCreationBlock('customer'` or `planCreationBlock('agent'` respectively. It also asserts that no file under `src/` calls `customerType(`.

- [ ] **Step 1:** Write the tripwire test. Run it and expect FAIL.
- [ ] **Step 2:** Add the two guards.
- [ ] **Step 3:** Switch every reader, update `createAjoPlan` and its callers, and delete `customerType`.
- [ ] **Step 4:** Make the UI changes.
- [ ] **Step 5:** Run `npx tsx --test tests/plan-creation-guard.test.ts tests/customer-type.test.ts` (and any `tests/ajo*.test.ts` that aren't `.int.`). Expect PASS. Then run `npx tsc --noEmit` and expect no new errors compared with `main`.
- [ ] **Step 6:** UI check at 360px (`ui-check-recipe`). Check an offline customer's Save screen with an ended plan, and the agent add-plan picker.
- [ ] **Step 7:** Commit: `feat: block plans across the online/offline line; every reader uses the stored type`.

### Task 4: Fee refund records

**Files:**
- Create: `src/lib/fee-refund.ts`
- Modify:
  - `src/lib/commission-ledger.ts`: `LedgerSource` gains `'fee_refund'`. Add `recordReversal(tx, e: LedgerEntry)`, which writes a negative amount; `recordCommission` still refuses amounts ≤ 0.
  - `src/lib/commission-history.ts`: `LEDGER_SOURCE.fee_refund = 'refund'`. `CommissionSource` gains `'refund'`.
  - `src/app/superadmin/_components/commission-history-drawer.tsx`: label `refund: 'Refunds'`.
- Modify: `src/lib/notifications.ts`. Add kinds `'fee_refunded' | 'commission_returned'` and `feeRefunded(f: { ref: string; customerId: string; agentId: string | null; customerName: string; planGoal: string; fee: number; agentShare: number })`, with dedupe keys `fee-refund:${ref}` and `fee-refund-agent:${ref}`. Copy:
  - customer: `${naira(fee)} platform fee refunded to ${planGoal}`
  - agent: `${naira(agentShare)} commission returned: ${name(customerName)}'s fee was refunded`
  - Add the matching rebuild to `src/lib/notification-sweep.ts`, from `Transaction` rows with `type: 'fee_refund'`.
- Modify: `tests/notification-coverage.test.ts`. Add the site pattern `/type:\s*'fee_refund'/`.
- Modify, adding a `fee_refund` label "Fee refund" (money in, sign `+`): `src/components/customer/DepositReceipt.tsx`, `src/app/dashboard/transactions/page.tsx` (TYPES), `src/app/superadmin/transactions/page.tsx` (TYPES), and the customer transactions page if it maps types.
- Test: `tests/fee-refund.test.ts`, covering the pure split. `refundSplit(ledgerRows)` returns `{ fee, agentShare, platformShare }` from a deposit's original ledger rows. Agent-less deposits give `agentShare = 0`. It refuses with `ALREADY_REFUNDED` when the deposit already has a `fee_refund` ledger row.

**Interfaces:**
- Produces: `refundCashFee(tx, { depositTxnId: string; reason: string; actorName: string }): Promise<{ ref: string; fee: number; agentShare: number; platformShare: number }>`. It throws `NOT_REFUNDABLE` (no fee or already refunded) or `AGENT_BALANCE_LOW`.
- Produces: `writeRefundRecords(tx, facts, { moveMoney: boolean })`, the record-writing half that both `refundCashFee` (`moveMoney: true`) and the repair script (`false`) use.

- [ ] **Step 1:** Write the failing tests for `refundSplit` and the notification copy (`notifications.feeRefunded` output). Run them and expect FAIL.
- [ ] **Step 2:** Implement the ledger reversal, the catalogue entry, the sweep, `refundSplit`, `writeRefundRecords` and `refundCashFee`. Notify inside the same transaction, with `// notify: feeRefunded` above the write.
- [ ] **Step 3:** Add the screen labels.
- [ ] **Step 4:** Run `npx tsx --test tests/fee-refund.test.ts tests/notification-coverage.test.ts tests/customer-type.test.ts`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: fee refunds are visible records (customer history, agent notice, ledger reversal)`.

### Task 5: Repair the 4 past refunds (script, run by hand)

**Files:**
- Create: `scripts/repair-fee-refunds-2026-11-12.ts`. It reads the 4 `cash_fee_refunded` audit entries for the deposit ids, ledger ids and amounts. In one transaction it restores each deposit's `feeTaken` and the 8 ledger rows (original ids, dated at their deposit), then calls `writeRefundRecords(..., { moveMoney: false })`. It prints the balances before and after, which must be identical, and refuses to run twice (a `fee_refund` ledger row already exists for the deposit).
- Dry run: on a `.backup` copy on the server. Then the developer runs it against production.

- [ ] **Step 1:** Write the script. Dry-run it against a local copy made from the latest prod backup. Expect 4 refund transactions, 8 restored rows, 8 reversal rows, 8 notifications, and unchanged balances.
- [ ] **Step 2:** Commit: `chore: one-off repair turning the 4 hand fee refunds into proper records`.

### Task 6: Release check

- [ ] **Step 1:** Run `/verify`, then review the changes (`code-reviewer` + `security-auditor`, since this touches money paths and authorization).
- [ ] **Step 2:** Deploy needs the owner's approval. Record the pre-deploy count of customers with a `self` plan (24 on 2026-11-11). After deploy, run read-only `SELECT type, COUNT(*) FROM Customer GROUP BY type` on prod. Expect online = that count and nothing else changed.
