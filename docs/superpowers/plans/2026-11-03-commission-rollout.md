# Commission model rollout checklist

Design: `docs/superpowers/specs/2026-11-03-commission-restructure-design.md`. Everything is committed on main and inert until step 7.

## What changes for money at go-live (default settings: 60 / 7.5 / 60)

| Offline plan | Today | After go-live |
|---|---|---|
| Daily, ₦500 a day, ₦60,000 saved | Fee when the customer collects: about ₦1,935 (1/31 of the balance), 60% agent, 40% platform | The first ₦500 is the fee, taken from the first deposit: agent ₦300, platform ₦200. Nothing is taken at collection. |
| Weekly, ₦10,000 a week, ten deposits | Fee at collection: 7.5% of ₦100,000 = ₦7,500 (agent ₦4,500, platform ₦3,000) | 7.5% of each deposit: ₦750 per deposit (agent ₦450, platform ₦300), same ₦7,500 in total but taken as the customer saves. The agent sees ₦450 on every deposit. |
| Online (self-saving) plan | No fee | No fee |

Loans and repayments do not change.

## Plans already running at go-live

- A running **daily** plan takes the first day's amount from its next deposit after go-live (the customer's balance drops by that amount then). If it gets no further deposit, the amount is taken when the customer collects.
- A running **weekly or monthly** plan pays the percentage on its older deposits when the customer collects. New deposits are charged as they are made.
- Collection requests already in flight at go-live keep the old fee and the old 60/40 split.
- Backdated deposits (dated before go-live) take no fee at deposit and are covered at collection.

## Steps (each needs the owner's approval)

1. Confirm the three savings settings on the Commission page with the client: agent's share of the first day's amount, the weekly and monthly fee, and the agent's share of that fee. The defaults (60, 7.5, 60) are only a starting point, and a 25% cap applies to the weekly and monthly fee.
2. Deploy the code. The migration adds three columns (`feeCollected` on plans, `feeTaken` on transactions, `feeAgent` on collection requests), all defaulting to 0. Behavior does not change.
3. Check `npx tsx scripts/commission-go-live.ts` prints "not set: the new commission model is OFF".
4. Open the Commission page as a super admin: the four groups show, a rate can be changed with the PIN, and System commission starts at its current figure.
5. Tell agents (they earn per deposit and see their share at once) and customers on offline plans (the fee is the first day's savings, or a percentage of each deposit).
6. Owner approves the go-live time.
7. On the server run `npx tsx scripts/commission-go-live.ts --now`.
8. Watch the first deposits on an offline plan: each should add ledger rows (`daily_first` or `periodic_fee`), raise the agent's commission balance by their share, and show a Platform fee row on the receipt.

## Rolling back

Remove the `commissionGoLive` setting (or replace it with `--force`): new deposits and new collection requests go back to the old way. Collection requests already created as `v2` keep the new rule. Fees already taken stay taken, and ledger rows are never edited or deleted.
