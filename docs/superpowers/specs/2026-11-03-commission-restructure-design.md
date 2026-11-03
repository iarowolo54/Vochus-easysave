# Commission restructure (design)

Date: 2026-11-03. Status: draft for owner approval. Supersedes `2026-11-03-commission-rates-functional-design.md` for everything about savings. Loans and repayments are unchanged from that design and already live. Covers task-list items 11 and 12.

## Why

The owner and the client agreed a different savings fee model. The per-deposit percentage model built earlier was never switched on (no go-live date is set in production), so nothing live has to be undone.

## The model (decided by the owner and client, 2026-11-03)

1. **Online customers** (self-saving plans, `source = 'self'`): no fee and no commission, as today.
2. **Offline daily plans.** The first single day's amount of the plan (`dailyAmount`) belongs to the platform. It is taken in full from the first deposit(s), so the customer's balance starts lower by that amount, and there is no fee when the customer collects. It is not "whatever was deposited on day one": if the customer pays several days at once, or a bigger first amount, only one day's amount is the fee and the rest goes to the plan balance. A Super Admin setting decides how that first-day amount splits between the agent and the platform, in percent. The agent sees their share immediately.
3. **Offline weekly and monthly plans.** A fixed percentage of **each deposit** is the platform fee, a Super Admin setting. That fee is itself split between agent and platform by a second percentage, also a Super Admin setting. The agent sees their share immediately, on every deposit.
4. **Loans and repayments** stay as they are (agent 1% of principal, 0.5% of each repayment, platform 5% of interest, all editable).
5. **Plans already running at go-live adapt to the new rules** (owner: "they should all adapt").

## Settings (the Commission page, rebuilt)

| Setting | Meaning | Default (my call) |
|---|---|---|
| Daily plans: agent share of the first day's amount | % of that amount to the agent, the rest to the platform | 60 |
| Weekly and monthly plans: platform fee | % of each deposit taken as the fee | 7.5 |
| Weekly and monthly plans: agent share of that fee | % of the fee to the agent, the rest to the platform | 60 |
| Loan commission, repayment commission, platform share of loan interest | as today | 1, 0.5, 5 |
| Late repayment penalty | shown as "Not applied yet" | 2 |

The old agent savings and platform savings settings are removed. Validation: every value 0 to 100; the weekly and monthly fee is capped at 25 (typo guard, my call); loan caps stay (10, 10, 50). Saving still needs the approval PIN, and the audit log records old to new values.

## Mechanics

**Go-live switch (kept).** All of this applies only from the `commissionGoLive` date. Before it, savings works the old way.

**At a deposit** (offline plan, deposit dated after go-live), inside the deposit's own transaction:
- Daily: fee = `min(deposit, dailyAmount - plan.feeCollected)`, never negative. Weekly and monthly: fee = `deposit x fee%`.
- Agent share of the fee = fee x the matching agent percent (rounded to kobo); platform share = fee minus that.
- The plan balance is credited `deposit - fee`. `plan.feeCollected` goes up by the fee. The agent's commission balance goes up by the agent share; the platform Revenue wallet goes up by the platform share. Ledger rows are written for both parties. The transaction records the fee taken.
- Partial first payments are fine: a daily plan keeps taking fee from deposits until one day's amount has been collected.

**Backdated deposits** (dated before go-live) take no fee at deposit time; they are settled at collection, below.

**At collection (redemption).** The old redemption fee is gone. What remains is a one-off settle-up for anything not yet collected, worked out at request time and stored on the request:
- Daily plan: `min(dailyAmount - plan.feeCollected, balance)`. For a plan that was already running, this is taken from its next deposit after go-live if there is one, otherwise here.
- Weekly or monthly plan: `fee% x` the part of the balance deposited before go-live (the plan's saving transactions dated before go-live, capped at the balance).
- Split between agent and platform with the same percentages as above, with the agent's part stored on the request. A later rate edit changes neither what the customer receives nor the stored split.
- Online self plans: nothing.

**Requests in flight at go-live** keep the old fee and the old 60/40 split.

## Ledger

Reuses `CommissionLedger` (append-only, unique per source, reference and party). New sources: `daily_first`, `periodic_fee` (per deposit, reference = the deposit ref), `settle_up` (reference = the redemption ref). Old sources stay for loans, repayments and old redemptions.

## Goals

- The Commission page controls every savings fee, with the three settings above.
- Each fee is recorded once, in the same transaction as the event.
- Agent and customer screens that preview a plan show the fee the new rules will actually take.
- The System commission figure and the commission history include the new sources.

## Non-goals

- Changing loans, repayments, savings interest, rewards or how agents are paid out.
- A late repayment penalty.
- Taking any fee from online customers.
- Reducing any customer's balance on the go-live day itself (running plans adapt on their next deposit or at collection).

## Anti-goals

- Taking a fee twice from the same plan, or paying an agent for the same fee twice.
- A deposit that succeeds while its fee or commission is lost, or the reverse.
- A running plan losing more than the new rules say, or the platform keeping a fee the customer was not told about.

## Left to the builder

File names inside the plan, ledger column types, exact wording of customer and agent copy, and test layout.

## Calls I made (owner can change any)

- Defaults in the table above (they match the old 60/40 split and the old cash-weekly rate of 7.5%); the owner must set the real numbers before go-live.
- The weekly and monthly fee cap of 25%.
- A daily plan whose deposits total less than one day's amount is still charged only what it has paid, collecting the rest from later deposits.
- Running plans adapt on their next deposit (daily) or at collection (settle-up), not on the go-live day.
- `Transaction.feeTaken` is added so receipts and history can show the fee.
