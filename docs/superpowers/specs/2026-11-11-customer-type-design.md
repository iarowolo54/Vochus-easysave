# Customer type: online vs offline, decided at registration

Date: 2026-11-11 · Status: approved in chat by the owner's developer

## Why

Today a customer's type is guessed from their plans (`src/lib/customer-type.ts`: online if any plan has
`source: 'self'`). That's wrong in principle and was wrong in production: old self-sign-up code created plans
as `agent`, so 13 self-registered customers were listed, and charged, as cash savers. 7 of them were fixed
by hand on 2026-11-11 (audit action `plan_switched_to_online`).

The owner's rule:

- **Online customer**: registered themselves (`/api/customer/enroll`). Creates their own plans.
- **Offline customer (cash saver)**: registered by an agent (approved `CustomerRequest`,
  `src/lib/customer-request.ts`). Typically a market woman. The agent creates plans and collects cash.

The type is fixed when the account is created and stored on the customer. Plans never change it.

## Goals

1. `Customer.type` (`'online' | 'offline'`) is stored and set once, at creation, by the creating path.
2. Server-side blocks:
   - An offline customer can't create a plan from the customer app (`POST /api/customer/plan`). Returns 403
     with a plain message.
   - An agent can't add a plan for an online customer (`POST /api/customers/plan`). Returns 403.
3. Everything that asks "what type is this customer" reads the stored field. That covers the agent and admin
   lists and their filters, the admin detail, the Ajo screens and payout plans, the redemption-declined notice,
   and the early-redemption admin view.
4. A test fails if a plan's `source` ever disagrees with its owner's type for a newly created plan.

## Non-goals

- Switching a cash saver to online later. The owner deferred this.
- Rewriting the money rules. Fees, commission, interest, redemption, auto-debit and catch-up keep reading the
  **plan's** `source` (about 40 call sites). With the blocks in place, a new plan's `source` always matches its
  owner, so those rules follow the customer without being touched. *(Developer's call: the safest route.)*
- Blocking sign-in for offline customers. The owner considered this and rejected it: they keep signing in as today.
- Relabelling the 7 customers the owner is checking with agents (Jeremiah Jeremiah, Ifeanyi Ogwu,
  Ololade Kabirat, Ifeoluwa Okeowo, Samuel Adedoyin, Elizabeth Adedoyin, Oluwafemi Akanbi). That's done by
  hand once the answers come in.

## Anti-goals

- Any customer's type, fees or interest changing as a side effect of the deploy.
- Agents losing the ability to serve a customer they serve today, until the owner says so.

## Design

**Schema.** Add `type String @default("offline")` to `Customer`, in a new forward-only migration. The same
migration backfills it with today's rule, so nothing changes on deploy:
`UPDATE Customer SET type='online' WHERE id IN (SELECT customerId FROM SavingsPlan WHERE source='self')`.
*(Developer's call: preserving today's labels exactly is what keeps the pending customers serviceable. The
audit-log creation record is used afterwards, by hand, for the pending ones.)*

**Creation.** `customer/enroll` sets `type: 'online'`. `customer-request.ts` approval sets `type: 'offline'`.
Both are explicit, with no reliance on the default.

**Blocks.** As in Goals 2. The messages are plain:

- Customer app: "Your plans are set up by your agent. Please ask them to open a new plan for you."
- Agent: "This customer saves on the app. They open their own plans."

The customer-app UI hides the new-plan entry point for offline customers (`/api/customer/me` exposes `type`).
The agent UI hides "add plan" for online customers. The server is the real gate.

**Ajo payout plans.** `createAjoPlan`'s `online` flag comes from the stored type.

**Readers.** `customerType(plans)` is replaced by reading `customer.type`. Keep a tiny helper
(`isOnline(c)`) and narrow unknown strings to `'offline'`. Filters become `where: { type }`. The admin
per-plan "Type" row shows the customer's type.

## Left to the builder

The exact UI placement of the hidden buttons, the test layout, and whether `lastPaidAtOf` stays in
`customer-type.ts`.

## Deploy

The schema changes, so `deploy.sh` runs `migrate deploy` (already unconditional). Back up first, as the
script does. After deploy, run a read-only check: the type counts match the pre-deploy derived counts
(online 24 / offline 32 on 2026-11-11, after the 7-plan switch).
