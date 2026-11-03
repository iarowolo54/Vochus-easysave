# Commission rates that control real money (design)

Date: 2026-11-03. Status: draft for owner approval. Covers task-list items 11 and 12.

## Why

The super admin Commission page has a "rates" section (agent savings, agent loan, agent repayment, platform savings, platform loan interest, late penalty). Changing it does nothing: the values are saved, but no money code reads them. Live money uses fixed numbers in `src/lib/wallet-rates.ts`. The owner wants the page to be the single source of truth, wants agents paid on every savings deposit ("Option A"), and wants the system's own commission shown.

## What is true today (checked in the code)

- The page saves to `PlatformSetting` key `commissionRates`. Only `api/admin/commission/rates` and the page read it.
- Loans: agent gets `principal × 1%` at disbursement, `repayment × 0.5%` per repayment; the platform books `interest × 5%` to the Revenue wallet. All hardcoded.
- Savings: agents earn nothing on deposits. The customer fee is taken at redemption: about 3.2% of balance for cash daily, 7.5% cash weekly, 2.5% bank daily, 3.5% bank weekly, a month of the daily amount when an admin starts it; split 60% agent, 40% platform. The page's own wording ("per savings deposit", 0.4% agent, 1.6% platform) does not match any of this.
- `source = 'self'` plans (online self-savers) pay no fee today.
- The late repayment penalty rate is not applied anywhere (`EARLY_EXIT_PENALTY = 0`).
- Commission is credited by adding to `Agent.commissionBalance`; agents are paid through the existing withdrawal flow. That flow stays as it is.

## Decided by the owner

1. **Option A.** The agent is credited the agent savings rate on every savings deposit, at the time of the deposit.
2. **The customer's redemption fee becomes the platform savings rate, applied to the balance, on every payout path** (customer-started, agent-started, admin-started). The agent's 60% cut is removed from the redemption fee so the agent is never paid twice. Customers pay less than today.
3. The rates page is the single source of truth for every rate it shows.

5. **Late repayment penalty is left out of this work.** It is a new customer charge, not a rate wiring fix. The page labels it "Not applied yet".
6. **Older plans (owner, 2026-11-03):** every redemption requested after go-live uses the new fee, including on part-paid plans. To keep agents whole, when such a plan is redeemed the agent is credited the agent savings rate on the part of the balance that was deposited before go-live (the "catch-up"), once, recorded in the ledger as `source = 'savings_catchup'`. Deposits made after go-live pay the agent at deposit time as in Option A.

## Goals

- One function returns the current rates; every money path calls it. No fixed commission numbers remain in the code.
- Each commission or platform fee is recorded once, in the same database transaction as the event that caused it, with the rate and amount used. Changing a rate later never rewrites history.
- The Commission page shows the real figures: agent commission earned and the system's own commission (platform fees).
- The commission history drawer becomes exact for events from the go-live date onward.

## Non-goals

- Changing how agents are paid out (withdrawals, Paystack, the commission-payout button).
- A penalty for late repayments.
- Paying commission at deposit time for deposits made before go-live (they are paid once, at redemption, by the catch-up).
- Changing loan interest rates, savings interest, or reward fees.

## Anti-goals (would make it a failure even if it "works")

- An agent paid twice on the same savings (per deposit and again at redemption).
- A deposit that succeeds but whose commission is lost, or the other way round. They are written together or not at all.
- A rate edit that silently changes a redemption already requested or a payout already shown to a customer.

## Design

**Rates source.** Add `getCommissionRates()` in `src/lib/commission-rates.ts` that reads `commissionRates`, falls back to the documented defaults, and validates the shape. It reads per request (no cache): two server instances share one database, and a stale cache would pay one agent at an old rate. The existing `getStoredCommissionRates` is replaced by it.

**Units** follow the page's own wording: all rates are percent; agent and platform savings are percent of each deposit amount; agent loan is percent of the principal at disbursement; agent repay is percent of each repayment; platform loan is percent of interest earned (as today).

**Ledger.** New append-only table `CommissionEntry`: id, party (`agent` or `platform`), agentId (null for platform-only rows), source (`savings`, `loan`, `repayment`, `redemption_fee`, `reward`), sourceRef (the transaction or redemption reference), customerId, base, ratePct, amount, createdAt. Unique on (source, sourceRef, party) so a retried request cannot pay twice. Rows are never updated or deleted. A forward-only migration adds it.

**Savings deposits.** On every deposit that is not a `self` plan (agent cash, bulk catch-up, auto-debit, online payments), inside the existing deposit transaction: credit `Agent.commissionBalance += money(amount × agentSavings%)` for the customer's agent and write the agent ledger row. If the customer has no agent, no agent row is written.

**Redemption fee.** `redemptionDeduction` stops guessing by cadence and cash/bank. The fee is `balance × platformSavings%` for all initiators; `source = 'self'` still returns zero. The fee is stored on the redemption record at request time (as `penalty` is today) and approval uses the stored number, so a later rate edit does not change a pending payout. On approval the platform fee is booked to the Revenue wallet and the platform ledger row is written; the agent no longer receives a redemption cut. The super admin early-redemption preview uses the same function.

**Loans.** Disbursement and repayment read `agentLoan`, `agentRepay` and `platformLoan` from the rates function and write ledger rows alongside the existing balance changes.

**Page.** The rates section keeps its layout. Saving a rate change requires the approval PIN (like other money actions) and the API rejects values that make `agentSavings + platformSavings` exceed 10% as a typo guard (my call, easy to loosen). The late penalty row is labelled "Not applied yet" so nobody believes it is live.

**Item 12, system commission.** The Commission page gets a "System commission" figure: platform fees earned (savings redemption fees plus the platform share of loan interest), with the same date presets as the agent history, read from the platform ledger rows.

**History drawer.** `commission-history.ts` reads ledger rows for events from go-live. Older events keep the current reconstruction, labelled as reconstructed.

## Order of work (each step ships on its own)

1. Rates function + ledger table + the tests that pin current behaviour.
2. Loans and repayments on the rates function (smallest, no behaviour change at default rates: 1%, 0.5%, 5%).
3. Savings deposit commission (Option A).
4. Redemption fee change, together with step 3 in the same deploy so agents are never unpaid and never paid twice.
5. Page changes (PIN, cap, penalty label) and the System commission figure.

Steps 3 and 4 must ship together. Steps 1, 2 and 5 can ship earlier.

## Risks

- **Money maths change for every redemption** after go-live. It needs a deploy note for agents and customers and a check against a few real plans before and after.
- **Agent income shifts timing:** from redemption to deposit. Agents' commission balances will rise as customers save, and the platform has paid nothing out of Revenue for it: commission is an accounting credit, paid when agents withdraw, as today.
- **Catch-up base:** the part of the balance deposited before go-live is the sum of that plan's saving transactions dated before go-live, capped at the balance at redemption. The go-live date is stored as a setting when step 3 ships.
- **In-flight redemptions** requested before go-live keep their stored fee and still pay the agent cut they were computed with. Only new requests use the new rule.
- **Two server instances, one SQLite file:** ledger writes sit inside the existing short transactions; no extra long ones.

## Left to the builder

Names of the new files and the exact ledger column types, the test layout, the wording of the "Not applied yet" label, and how the ledger rows are shown in the drawer.

## Calls I made (owner can change any)

- No cache on the rates read.
- The 10% combined cap and PIN on rate changes.
- Self-source plans earn no commission (they already pay no fee).
- No clawback: there is no savings reversal flow today.
