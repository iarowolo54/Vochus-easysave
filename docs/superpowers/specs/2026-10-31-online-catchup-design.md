# Online catch-up / pay-ahead — design

**Date:** 2026-10-31
**Status:** Approved — scope locked (V1 = missed-days only, daily + weekly plans; see "Scope decisions"). Ready for implementation plan.

## Intent & why

Online (self-service) savers who miss contributions have no way to catch up, and no way to
pay ahead. Agents already have this for **offline** customers (Record savings → "Several days"
→ pick missed/future days → bulk pay from the agent wallet). The client now wants the online
customer to do it **themselves, with their own card (Paystack)**: tap the days they missed
(and optionally days ahead), see the total, pay once, and have those days show as covered.

### The constraint that shaped everything

Online plans **earn interest**; offline plans do not (accrual is gated to `source: 'self'`).
Interest (`src/lib/savings-interest.ts` `accruedInterest`) counts each deposit toward every
monthly anniversary where `deposit.createdAt <= anniversary`. And the savings calendar
(`src/lib/savings-card.ts` `buildSlots`) marks a scheduled day "saved" **by a deposit's stamped
date**. So the naive implementation — stamp the chosen missed dates so the calendar fills — would
**backdate deposits and retroactively inflate interest**. That is exactly why online deposits are
force-stamped "now" today, and why this feature was blocked.

**Resolution (owner decision, confirmed): credit today, mark days covered.** The money is a normal
contribution stamped **now** (interest accrues correctly from the day they pay — no gaming), and the
specific covered days are recorded in a **separate coverage record** that the interest math never
reads. The calendar reads deposits **and** coverage; interest reads deposits only.

## Goals (V1)

- An online customer on a **daily or weekly** plan can select their **missed past** scheduled days
  (today included) on their own plan, see the total, and pay the lump sum with their card (Paystack).
  (Pay-ahead/future days and monthly plans are out of V1 — see Scope decisions.)
- On success: balance is credited now, and each selected day is marked **covered** so the savings
  calendar shows it as saved.
- Interest is computed exactly as today (from contribution `createdAt`, always "now") — catch-ups
  earn **no** back-interest.

## Non-goals / anti-goals

- **No backdating of contributions.** Coverage is display/accounting only; it must never feed interest.
- **No change to the offline/agent flow** (it already works and is correct for offline).
- Not for agents acting on online customers in V1 — this is customer self-service.
- No partial-day amounts: a day is covered in full (one slot = the plan's per-slot amount) or not.

## The model

### Slots (schedule)
Reuse `src/lib/savings-card.ts`. A plan has one slot per scheduled contribution: per **day**
(daily) or per **week** (weekly) — monthly plans are out of scope for V1 unless `buildSlots`
already handles them (it treats non-weekly as daily; confirm during planning). Each slot has a
state: `saved | missed | today | upcoming`.

- **Per-slot amount** = the plan's contribution for that slot: daily → `dailyAmount`; weekly →
  `dailyAmount × 7`. (Matches the save page's `perPayment`.) The payment total = Σ selected slots.

### Coverage record (new)
A new table marks which scheduled days a catch-up payment covers, independent of deposit dates:

```
model PlanDayCoverage {
  id             String      @id @default(cuid())
  savingsPlanId  String
  coversKey      String      // 'YYYY-MM-DD' local — the scheduled day covered (weekly: the slot's first day)
  ref            String      // the paying Transaction.ref (audit link)
  createdAt      DateTime    @default(now())
  savingsPlan    SavingsPlan @relation(fields: [savingsPlanId], references: [id])
  @@unique([savingsPlanId, coversKey])   // a day can only be covered once
}
```

`buildSlots` gains an optional `coveredKeys: Set<string>`: a slot is `saved` when
`paid.has(key) || covered.has(key)`. Interest code is untouched — it never reads coverage.

## Flow

1. **Customer UI** (customer app, their plan — daily/weekly only; hidden for monthly): a "Catch up"
   screen showing the slot calendar (reuse `SavingsCard`/`buildSlots` rendering). **Missed past slots
   (and today) are tappable; future/upcoming slots are NOT selectable in V1**; already-saved/covered
   slots are not. Multi-select, running total. States must make clear a selection isn't paid until
   "Pay ₦X".
2. **Init** — `POST /api/customer/catchup/init` (customer JWT): validate the selected slot keys
   against the plan's schedule (reject already-saved/covered, out-of-range, or >N cap, e.g. 90);
   compute total = Σ per-slot amounts server-side (never trust a client amount); create a Paystack
   transaction + a `PaymentIntent` bound to {customer, plan, amount, coversKeys}. Reuse the pattern
   in `customer/paystack/init`. Store the selected `coversKeys` on the intent (new column or a side
   record) so verify knows what to cover.
3. **Pay** — Paystack checkout → callback `/customer/save/callback` (reuse).
4. **Verify** — `POST /api/customer/catchup/verify` (or extend `customer/paystack/verify`): verify
   with Paystack, bind to the owned pending intent, check amount/currency, then **atomically**:
   consume the intent, create **one** `saving` Transaction (`createdAt = now`, `amount = total`),
   increment plan balance, and insert `PlanDayCoverage` rows for each `coversKey`. Idempotent on the
   unique `Transaction.ref` and `@@unique([savingsPlanId, coversKey])` (a replay credits/covers once).
5. **Display** — the plan's calendar now reads coverage, so the selected days show saved. The source
   feeding `SavingsCard` (customer/me or a deposits/coverage endpoint) must include coverage keys.

## Auto-debit interaction (decision needed)

Auto-debit (shipped) funds online plans on a schedule. If the customer **prepays a future slot**
that auto-debit would later charge, they'd fund that day twice. Two options:
- **(a, recommended)** When auto-debit is about to charge for a cycle whose slot is already covered,
  **skip it** (advance `nextRunAt`). Needs `auto-debit-run` to check coverage. Clean, no double-fund.
- **(b)** Allow both (savings just accumulate; overpaying isn't a loss). Simpler, but a customer who
  deliberately prepaid a day could still be auto-charged for it — feels wrong.

**My call unless you say otherwise: (a).** If future prepay is dropped from V1 (missed-days only),
this interaction disappears and auto-debit is untouched.

## Security / correctness

- Server computes the amount from the validated slot set; the client never sends an amount.
- All selected keys validated against the plan's own schedule and ownership (customer JWT → plan).
- Credit + coverage happen in one `$transaction`; unique `ref` + unique coverage key make replay safe.
- Interest invariant (tested): catch-ups never change accrued interest — a test asserts accrued
  interest is identical before/after a catch-up (money stamped now).
- No card/auth data logged; reuse the existing intent/verify guards.

## Builder-check resolutions (settled; engineer's calls)

A fresh engineer reviewed this against the code. The model holds (interest reads deposit `createdAt`
only, so coverage can't inflate it). Settled here so the plan is unambiguous:

- **Store coverage keys on the intent via a new nullable `coversKeys String?` (JSON array) column on
  `PaymentIntent`** (scalar-only model today). Simpler than a side table; verify reads it back.
- **Extend `customer/paystack/verify`, don't add a callback branch.** When the consumed intent carries
  `coversKeys`, additionally insert `PlanDayCoverage` rows in the same `$transaction`. The callback page
  (`save/callback`) stays untouched (it already calls `paystack/verify`). The init can reuse
  `customer/paystack/init` with the computed total + `coversKeys`, or a thin `catchup/init` wrapper.
- **Mirror verify's existing side-effects:** it also writes a `CustomerPayment` row and calls
  `creditRegistrationReward` on the customer's first-ever saving (verify/route.ts). The catch-up path
  must write `CustomerPayment` the same way; the registration reward only fires on a true first save.
- **Covered-day details state (do not miss this):** a covered day has **no deposit**, so the
  day-details sheet (`SavingsCard.tsx` `DayDetails`) would wrongly say "Nothing was saved." Add a
  `covered` state: e.g. "Covered in a catch-up payment on <pay date>." Thread a covered flag through
  `useCardData`/`buildSlots` so the sheet can tell covered from saved-by-deposit.
- **Calendar data source:** `/api/customer/me` currently feeds only `saving` transactions to the card.
  Add a `PlanDayCoverage` query to `/me` and thread coverage keys dashboard → `SavingsCard` →
  `useCardData` → `buildSlots` (new 4th arg `coveredKeys: Set<string>`). Mechanical, several files.
- **Cap** selected slots at 90 per payment (matches the offline bulk route).

## Scope decisions (resolved — owner, 2026-10-31)

1. **V1 is MISSED-DAYS ONLY — no pay-ahead.** Customers can select only past missed slots (and today);
   future slots are not selectable. Consequence: there are no prepaid future slots, so **auto-debit is
   untouched** — the "Auto-debit interaction" section above does not apply to V1. (Pay-ahead is a named
   future follow-up and would reopen the auto-debit skip rule.)
2. **V1 supports DAILY + WEEKLY plans only; MONTHLY is blocked.** `buildSlots` renders monthly plans as
   daily slots (wrong), so the catch-up entry point is **hidden for monthly plans** (show a brief "not
   available for this plan" if reached). No monthly-slot work in V1. Daily + weekly is the common case.

## What's left to the builder

Exact file placement, the UI composition (reuse `SavingsCard` interactions), and the Prisma migration
for `PlanDayCoverage` + `PaymentIntent.coversKeys` — all in the implementation plan. Interest-invariance
gets an explicit test (accrued interest identical before/after a catch-up).
