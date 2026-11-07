# Flexible savings — design

Date: 2026-11-07. Status: draft for owner approval. Defaults chosen by Claude at the owner's request (2026-11-07).

Default rationale: 5% commission sits below the 7.5% weekly/monthly fee (flexible gets no per-deposit fee, so it must stay attractive while still paying the agent). 5% penalty makes a cash early break cost 10% in all — enough to make the term mean something. Agent gets 40% of the penalty (less than the 60% of commission) so agents earn something on a break but have no reason to encourage one.

## Why

Agents report customers asking to save **any amount, on any day, at any time**, for a period they choose,
instead of a fixed daily/weekly/monthly amount. The owner agreed on condition that the money is held for a
minimum term (3 months) and that breaking early costs a configurable penalty.

## What it is

A fourth plan type, **Flexible**, alongside Daily, Weekly and Monthly, for both customer types:

- **Cash (offline)** — agent-created customer; the agent records each cash deposit.
- **Online** — self-registered customer; pays in through the existing Save (bank transfer) flow.

The customer picks a **start date** and an **end date**. The term must be at least the minimum term.
Within the term they may deposit any amount (≥ the minimum deposit), any number of times a day.
Maturity and redemption follow the existing flows, including the redemption token.

## How Vochus and the agent earn

No fee on deposits. Earnings are taken once, when the money leaves the plan.

| | At maturity (on/after end date) | Early break (before end date) |
|---|---|---|
| **Cash flexible** | commission | commission **+** penalty |
| **Online flexible** | nothing | penalty only |

- Commission and penalty are each a **percent of the plan balance** at the time of the redemption request.
- Each is split between the agent and Vochus by its own configurable **agent share %**; the rest goes to Vochus.
- Interest: **online flexible earns interest exactly like other online plans** (same rate schedule, monthly
  anniversaries from the start date, on deposits made by each anniversary — `accruedInterest` already handles
  uneven deposits). **Cash flexible earns no interest**, same as all cash plans today.
- Online early break keeps the interest earned so far (today's online early-redemption behaviour); the penalty is
  a percent of the balance (savings), not of the interest.

## Super admin settings (new "Flexible savings" block)

Stored as one `PlatformSetting` row (key `flexibleSavings`, JSON), parsed/validated the same way as
`commission-rates.ts`. Every field falls back to its default if missing or invalid.

| Field | Meaning | Default | Guard |
|---|---|---|---|
| `minTermMonths` | shortest allowed term | 3 | 1–60 |
| `minDeposit` | smallest single deposit, ₦ | 100 | ≥ 0 |
| `cashCommissionPct` | commission on cash flexible at collection | 5 | 0–25 |
| `cashCommissionAgentPct` | agent's share of that commission | 60 | 0–100 |
| `penaltyPct` | penalty on early break (cash and online) | 5 | 0–25 |
| `penaltyAgentPct` | agent's share of the penalty | 40 | 0–100 |

Changes are audited (`logAudit`), gated by the same super-admin permission as commission rates. A rate edit
does not change a redemption already requested (the deduction and the agent's part are frozen on the
`EarlyRedemption` row at request time, as `feeRule: 'v2'` + `feeAgent` already do).

## Data model

No new tables. `SavingsPlan.cadence = 'flexible'`.

- `dailyAmount = 0`, `periodDays = days(start, end)`, `maturityDate = end date`.
- **Migration needed? No** — `cadence` is a free string. (No `ALLOW_DB_PUSH`.)

## Behaviour, by area

### Plan creation (registration + "start a new plan")
- Agent enrol (`dashboard/enrol`, `api/customers`), agent add plan (`dashboard/add-plan`, `api/customers/plan`),
  online enrol (`customer/enroll`, `api/customer/enroll`), online new plan (`api/customer/plan`).
- Flexible hides the amount field; shows Start date (existing DatePicker) and End date (`EndDateField`).
- Server: `end - start ≥ minTermMonths` calendar months (use the same month-clamping as interest), `≤ MAX_PLAN_DAYS`.
  Never trust the client's check.
- Fee preview line: replaced by the flexible sentence (cash: "X% commission when they collect; +Y% if they
  stop before the end date"; online: "No charge if you keep it to the end date. Stopping early costs Y%").

### Deposits
- `api/transactions/saving`: for flexible, accept any amount ≥ `minDeposit`; **skip `hasSavingOnDay`**; fee = 0
  (`feeTaken: 0`, no `feeCollected` change). The one-per-day rule stays for other cadences.
- Online Save flow: free amount entry for flexible plans, ≥ `minDeposit`.
- **Not applicable to flexible** (hidden in UI and refused on the server): auto-debit enrolment, missed-day
  catch-up, pay-ahead, bulk "several days" recording, paid-dates calendar, agent "today's round" expected amount.
- Deposits after the end date or on a Matured/Redeemed plan: refused — this is task 2 of the batch; flexible
  must at least not make it worse.

### Collection / redemption
- One hook: `collectionFee` in `src/lib/commission-ledger.ts` is already called by all three request paths
  (agent `transactions/redemption/request`, customer `customer/redeem`, admin `admin/early-redemption`).
  For `cadence === 'flexible'` (and after go-live) it returns
  `{ feeRule: 'v2', penalty: deduction, feeAgent }` using a new pure function `flexibleDeduction` in a new
  `src/lib/flexible-savings.ts`:
  - `early = at < maturityDate`
  - cash: `commission = pct(balance, cashCommissionPct)`, `penalty = early ? pct(balance, penaltyPct) : 0`
  - online: `commission = 0`, `penalty = early ? pct(balance, penaltyPct) : 0`
  - `deduction = min(balance, commission + penalty)`, `feeAgent = pct(commission, cashCommissionAgentPct) + pct(penalty, penaltyAgentPct)`
- Completion, ledger split, token, OTP, payout mode: unchanged (they already consume `penalty` + `feeAgent`).
- **Fix needed:** `isDaily()` in `savings-fee.ts` and the cadence checks in `wallet-rates.ts` treat any
  non-daily cadence as weekly/monthly — flexible must be handled explicitly first so it never gets the 7.5%
  per-deposit fee.

### Display
- Plan cards / lists / super admin customers & savings monitor: label "Flexible", show "Saved ₦X · ends <date>"
  instead of "₦X daily". No "next payment due"/missed-days nudges.
- Maturity notices: same as other plans.

## Non-goals
- No auto-debit, catch-up or pay-ahead for flexible.
- No change to interest maths, redemption flow, token/OTP, or payout mode.
- No change to how daily/weekly/monthly earn.

## Anti-goals (a failure even if it "works")
- Flexible plans silently charged the weekly/monthly per-deposit fee.
- A term shorter than the minimum accepted because only the browser checked.
- A rate change altering a redemption already requested.
- Cash flexible accruing interest.

## Tests (node:test via tsx, unit only)
- `flexible-savings.test.ts`: settings parse/validate; term check (exactly 3 months passes, a day short fails,
  month-end clamping); `flexibleDeduction` table (cash/online × mature/early, deduction capped at balance,
  agent split rounding).
- `savings-fee` regression: flexible deposit → zero fee; daily/weekly/monthly unchanged.

## Left to the builder
Copy wording within the plain-words rule; exact layout of the settings block matching the commission page;
where the flexible branch sits in each route.
