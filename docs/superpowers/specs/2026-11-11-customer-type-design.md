# Customer type: online vs offline, decided at registration

Date: 2026-11-11, updated 2026-11-12 · Status: awaiting the developer's review

## Why

Today the app guesses a customer's type from their plans (`src/lib/customer-type.ts`: online if any plan has
`source: 'self'`). That's wrong in principle, and in production it was wrong in practice. The old self-sign-up
code created plans as `agent`, so self-registered customers were listed as cash savers and charged as cash
savers. They paid the cash first-day fee and got no interest.

The owner's rule:

- **Online customer:** registered themselves (`/api/customer/enroll`). Opens their own plans.
- **Offline customer (cash saver):** registered by an agent (an approved `CustomerRequest`,
  `src/lib/customer-request.ts`). Typically a market woman. The agent opens plans and collects cash.

The type is fixed when the account is created and stored on the customer. Plans never change it.

## Production data already corrected (2026-11-11 to 2026-11-12, by hand)

- **Customers confirmed online, open plans moved to online rules.** Interest is backdated to each plan's
  start, as the owner chose.
  - Lydia Ojelade, Ojelade David, Arowolo Olusakin, Olayinka Arowolo, Isaiah Arowolo, Olaoluwa Ojo
  - Elizabeth Adedoyin
  - Jeremiah Jeremiah, Ololade Kabirat
  - Oluwafemi Akanbi
  - Audit action: `plan_switched_to_online`.
- **The cash first-day fee was refunded in full to the online customers who paid it.**
  - Customers: Elizabeth Adedoyin ₦500, Lydia Ojelade ₦500, Jeremiah Jeremiah ₦300, Ololade Kabirat ₦200.
  - Clawed back from: the agent's share (Elizabeth Adedoyin ₦600, Ilori Olawunmi ₦300) and platform
    revenue (₦600).
  - Audit action: `cash_fee_refunded`.
  - Owner's policy: whenever a plan moves to online rules, refund its cash fee in full, from both shares.
- **Confirmed offline, no change needed:** Samuel Adedoyin, Erioluwa Adedoyin, Maureen Isimoya,
  Esther Micheal.
- **Already online, no change needed:** Ifeoluwa Okeowo, Ifeanyi Ogwu, Ojelade Deborah, Blessing Olashile,
  Precious Obuite.
- **Test Customer (CST-00001)** was deleted at the owner's request.
- **Still waiting on agent Oyebanji Arowolo:**
  - Obaloluwa Arowolo signed herself up but is still offline. She has no deposits.
  - Oluwakemi Adeboye's account uses Oyebanji's own phone or email.

## Goals

1. `Customer.type` (`'online' | 'offline'`) is stored, and set once at creation by the path that creates the
   customer.
2. Server-side blocks:
   - An offline customer can't open a plan from the customer app (`POST /api/customer/plan`). Returns 403
     with a plain message.
   - An agent can't open a plan for an online customer (`POST /api/customers/plan`). Returns 403.
3. Everything that asks "what type is this customer" reads the stored field. That covers the agent and admin
   lists and their filters, the admin detail, the Ajo screens and payout plans, the redemption-declined notice,
   and the early-redemption admin view.
4. A test fails if a plan-creation route loses its guard, or if anything goes back to guessing the type from
   plans.

## Non-goals

- Switching a cash saver to online later. The owner deferred this.
- Rewriting the money rules. Fees, commission, interest, redemption, auto-debit and catch-up keep reading the
  **plan's** `source` (about 40 call sites). With the blocks in place, a new plan's `source` always matches its
  owner, so those rules follow the customer without being touched. *(Developer's call: the safest route.)*
- Blocking sign-in for offline customers. The owner considered this and rejected it: they keep signing in as
  today.
- Blocking agents from recording savings for online customers. The owner considered this and decided agents
  may keep saving for them.
- Relabelling the two customers still being checked. That's done by hand once Oyebanji Arowolo answers.

## Anti-goals

- Any customer's type, fees or interest changing as a side effect of the deploy.
- Agents losing the ability to serve a customer they serve today, unless the owner says so.

## Design

**Schema.** Add `type String @default("offline")` to `Customer`, in a new forward-only migration. The same
migration backfills it with today's rule, so nothing changes on deploy:
`UPDATE Customer SET type='online' WHERE id IN (SELECT customerId FROM SavingsPlan WHERE source='self')`.
*(Developer's call: after the hand corrections above, today's labels are right for everyone the owner has
confirmed. Preserving them keeps the unconfirmed customers working as they do now.)*

**Creation.** `customer/enroll` sets `type: 'online'`, and approving a `customer-request.ts` sets
`type: 'offline'`. Both set it explicitly rather than relying on the default.

**Blocks.** As in Goal 2. The messages are plain:

- Customer app: "Your plans are set up by your agent. Please ask them to open a new plan for you."
- Agent: "This customer saves on the app. They open their own plans."

The customer app hides "Start a new plan" for offline customers (`/api/customer/me` exposes `type`). When an
offline customer's plan has ended, the screen tells them to ask their agent instead. The agent's add-plan
screen doesn't offer online customers. The server is the real gate.

**Ajo payout plans.** `createAjoPlan` takes the stored type and sets the plan's `source` from it.

**Readers.** Reading `customer.type` replaces `customerType(plans)`. Any unknown value reads as
`'offline'`. Filters become `where: { type }`. The admin per-plan "Type" row shows the customer's type.

## Fee refunds as visible records (added 2026-11-12)

When a cash fee is refunded, the history must show it rather than be rewritten. The 4 hand refunds above
edited the original records: they set the deposit's `feeTaken` to 0 and deleted the ledger rows. Only the
audit log explains them.

**One function does a refund:** `refundCashFee(tx, { depositTxnId, reason, actorName })` in
`src/lib/fee-refund.ts`. Inside one transaction it:

1. Credits the plan with the fee.
2. Takes the agent's share back from `commissionBalance` with a conditional update. If the balance is too
   low, it refuses.
3. Takes the platform's share back from `PlatformWallet` Revenue.
4. Writes a `Transaction` with `type: 'fee_refund'` (amount = fee, method `'Adjustment'`, `note` = reason),
   linked to the customer, plan and agent.
5. Writes two `CommissionLedger` rows with `source: 'fee_refund'` and **negative** amounts (agent −share,
   platform −share), keyed to the refund's ref. Ledger sums, revenue reports and the admin commission drawer
   then net out correctly.
6. Notifies:
   - the customer: "₦500 platform fee refunded to {plan}"
   - the agent: "₦300 commission returned: {customer}'s fee was refunded"
   Both go through the catalogue, with matching sweep entries.
7. Writes an audit entry, `cash_fee_refunded`.

The original deposit keeps its `feeTaken`, because the fee really was charged. A deposit can be refunded only
once (unique on the deposit ref).

Screens label the new type "Fee refund" (money in for the customer). That covers the customer history and
receipt, the agent's transactions, and the admin transactions filter. The admin commission drawer shows
`fee_refund` rows as "Refunds".

**Repairing the 4 past refunds.** A one-off script, run by hand, restores the two pieces the hand refunds
deleted:

- the 4 deposits' `feeTaken`
- the 8 original ledger rows, with the amounts and ids recorded in the audit log and dated at their deposit

It then writes the refund records and the ledger reversals through the same pieces as `refundCashFee`, but
moves **no** money, because the balances are already final. Net effect: balances unchanged, and the history
reads "fee charged, fee refunded". The repair only adds and restores records and deletes nothing. It runs once
after the deploy, after a dry run on a backup copy.

## Left to the builder

The exact UI placement of the hidden buttons, the test layout, and whether `lastPaidAtOf` stays in
`customer-type.ts`.

## Deploy

The schema changes, so `deploy.sh` runs `migrate deploy`, which it already does unconditionally. The script
backs up first. After deploy, run a read-only check: the type counts must match the pre-deploy derived counts.
On 2026-11-12 that was 32 online and 28 offline out of 60, and it is re-counted just before deploying.
