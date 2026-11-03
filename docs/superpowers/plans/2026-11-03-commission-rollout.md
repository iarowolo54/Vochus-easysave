# Commission model rollout checklist

Design: `docs/superpowers/specs/2026-11-03-commission-rates-functional-design.md`. Everything is committed on main and inert until step 6.

## Fee comparison at the default rates (agent 0.4%, platform 1.6%)

| Plan | Old fee (agent / platform) | New fee (all platform) |
|---|---|---|
| Cash daily, ₦62,000 balance | ₦2,000 (₦1,200 / ₦800) | ₦992 |
| Bank weekly, ₦20,000 balance | ₦700 (₦420 / ₦280) | ₦320 |
| Online self plan, ₦30,000 | ₦0 | ₦0 |

The agent now earns 0.4% of each deposit as it is made (₦4 on a ₦1,000 deposit), and a one-off catch-up of 0.4% of the part of the balance deposited before go-live when an older plan is redeemed.

## Steps (each needs the owner's approval)

1. Deploy the code. The migration only adds the `CommissionLedger` table and the `EarlyRedemption.feeRule` column (default `v1`). Behavior does not change: loans and repayments pay the same at the default rates and now also write ledger rows.
2. Check `npx tsx scripts/commission-go-live.ts` prints "not set: the new commission model is OFF".
3. Check the Commission page: the rates still match what you expect, and "System commission" starts at ₦0.
4. Draft a short notice for agents (they earn per deposit, not at redemption) and customers (redemption fee is lower).
5. Owner approves the go-live time.
6. On the server run `npx tsx scripts/commission-go-live.ts --now`. From that moment deposits earn the agent commission and new redemption requests use the new fee.
7. Watch the first deposits: each should add a `savings` row to `CommissionLedger` and raise the agent's commission balance by the rate.
8. Redemptions requested before step 6 keep the old split when approved. Only new requests use the new fee.

## Rolling back

Delete the `commissionGoLive` setting (`--force` replaces it; removing the row turns the new model off for new deposits and new requests). Redemptions already created with `feeRule = 'v2'` keep the new rule. Ledger rows are never edited or deleted.
