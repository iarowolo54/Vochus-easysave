# Design: Direct debit — automatic savings funding via Paystack

Date: 2026-10-30
Status: **Approved** by the owner (2026-10-30); builder-check folded in
Author: brainstormed with the project owner

The fourth client item from the original batch ("direct customer account debit"),
deferred in the [savings-features design](2026-10-30-savings-features-design.md)
pending clarification. The client has now clarified it: today online savers must
**manually transfer money** into their plan each cycle; direct debit lets Paystack
**pull the contribution automatically** on schedule, so saving continues without the
customer lifting a finger.

This is an independent feature and ships as its own branch off latest `main`. It is
sequenced **after** Feature 3 (weekly summary), and reuses the daily cron that
Features 1 & 3 introduce (`GET /api/cron/daily`).

Stack reminder: Next.js App Router, Prisma + SQLite (`file:./dev.db`, hardcoded),
PM2 cluster (prod 2 instances, staging 1) on one SQLite file. Money fields are
`Float`; round with `money()` from `src/lib/wallet-guard.ts`. Three auth systems
(see `.claude/rules/auth-security.md`); the customer side uses the hand-rolled JWT
(`src/lib/customer-auth.ts`). Paystack keys already exist in `.env`:
`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET`. `AuditLog`
is append-only.

---

## Intent / why

Online savers (email-invited self-registrants) drop off when they have to remember
to fund their plan. Automating the contribution — the exact amount they already
committed to, on the cadence they already chose — removes the main cause of stalled
plans and compounds with Feature 1 (interest rewards holding the balance). This is
the single most-requested convenience from the client.

## Goals

- An online saver can **opt in** to auto-funding for a plan, in a few taps, and
  **cancel anytime**.
- Once on, Paystack automatically debits the plan's committed contribution on its
  cadence; each successful debit becomes a normal `saving` deposit and grows the
  balance (and therefore the interest base) with no manual step.
- Money movement is **atomic, idempotent, and reconciled** — a debit credits the
  plan exactly once, only after Paystack confirms the money moved.
- Failures are visible and recoverable: the customer is told, and saving resumes
  when they fix the payment method.

## Non-goals

- **Offline customers.** They have no email or card (an agent collects their cash);
  auto-debit does not apply to `source==='agent'` plans. See the
  [customer-types memory note](../../../README.md) / `customer-types-online-offline-savings`.
- Not changing the interest logic (Feature 1), redemption, or the manual-deposit
  path — auto-debit is an additional funding source, not a replacement.
- Not Paystack **Subscriptions** (plan-based). They bill a fixed amount and send
  `invoice.*` events; they fit poorly with a savings balance and per-attempt
  reconciliation. We drive the schedule ourselves.
- Not a general "pay any bill" wallet — scope is funding a savings plan only.

## Anti-goals (what makes this a failure even if it "works")

- **Debiting a customer who did not clearly consent, or after they cancelled.**
  A silent or un-cancelable recurring debit is a worse outcome than no feature.
- **Double-crediting or crediting without confirmed settlement** (treating a
  Paystack `processing`/webhook as done without re-verifying).
- **Leaking the `authorization_code`** (it can charge the card) into any response,
  log, or JWT.
- Draining a customer through endless retries on a dead card.

---

## Decisions made (owner + brainstorm)

| # | Decision | Source |
|---|----------|--------|
| D1 | **Online only** (`source==='self'`). | prior owner ruling; research gotcha |
| D2 | **Strictly opt-in, cancelable anytime** by the customer. | regulatory default (stated) |
| D3 | **Amount & timing match the plan's own schedule** — the plan's committed contribution, on its cadence (daily/weekly/monthly). | owner |
| D4 | **On failure: retry a few times, then notify + pause auto-debit only** (plan stays Active, customer can re-enable). | owner |
| D5 | **Customer pays the Paystack fee** — the debit is grossed up so the full contribution still lands in savings. | owner |
| D6 | **Mechanism: card recurring (`charge_authorization`) is the primary rail**; Paystack bank **Direct Debit** is an optional later rail, not in the first build. | builder call (see below) |
| D7 | **Daily plans are debited daily.** Owner decision 2026-10-31, overriding the earlier weekly-batching recommendation. | owner |
| D8 | **Auto-debit stops at `maturityDate`** — fires on cadence boundaries from enrollment until maturity, never on/after it, so total pulled never exceeds the committed term. No debit fires on or after maturity (every cycle is one `dailyAmount`, so no pro-rating); stops immediately if the plan leaves `Active`. | builder-check resolution |
| D9 | **Per-cycle amount = `plan.dailyAmount`** (one contribution), charged once per cadence period — NOT `dailyAmount × days`. Confirmed against the existing manual deposit path (`customer/paystack/init` defaults the deposit to `plan.dailyAmount`). | code-grounded |
| D10 | **Per-attempt record + reconciliation.** A new `AutoDebitAttempt` row per cycle; the daily cron re-verifies any attempt stuck `processing` via `GET /transaction/verify/:reference`, so a charge that never produces a webhook is still reconciled and still advances the failure count. | builder-check resolution |
| D11 | **Fee residual absorbed like the manual path; actual amounts recorded.** The plan is credited exactly `dailyAmount` (keeps interest/plan math exact); the card is charged the grossed-up amount (D5); any small gap between our gross-up estimate and Paystack's actual fee is absorbed by the merchant, exactly as the current manual deposit does (it credits the committed amount and doesn't reconcile the fee). The grossed-up charge, the estimated fee, and the actual settled amount are stored on the attempt for dispute support. **No `PlatformWallet` entry** — this is the customer's own money, unlike platform-funded interest. | code-grounded |

### D5 detail — grossing up the fee
Paystack's fee is **1.5% + ₦100, with the ₦100 waived under ₦2,500 and the whole
fee capped at ₦2,000** (same for card and Direct Debit;
[pricing](https://support.paystack.com/en/articles/2130306)). So for normal savings
amounts the fee is just **1.5%** (₦100 → ₦1.50; ₦1,000 → ₦15).

To keep the saved amount clean (the `saving` deposit must equal the plan's
contribution `C`, so the interest base and plan math stay exact), the customer is
debited a grossed-up amount and we credit exactly `C`:

```
feeRate    = 0.015                      // for C below the ~₦2,500 band; builder applies the
                                         //   +₦100 flat and ₦2,000 cap for larger amounts
grossDebit = money(C / (1 - feeRate))    // rounded up to whole kobo at the Paystack boundary
creditedToSavings = C                    // the saving Transaction amount
```

The customer sees a debit slightly larger than `C`; the full `C` is saved. The exact
kobo math (`Math.round(amount * 100)`) lives at the Paystack call only.

### D6 detail — why card first, Direct Debit later
Research ([recurring charges](https://docs-v2.paystack.com/docs/payments/recurring-charges),
[direct debit](https://docs-v2.production.paystack.co/docs/payments/direct-debit)):
- **Card** activates immediately after one small first charge (min ₦50) with 2FA, then
  repeat charges via `POST /transaction/charge_authorization`. Works today.
- **Direct Debit** (bank mandate) is real but Nigeria-business-only, needs **up to 24h**
  to activate (plus a refunded ₦50 validation debit), supports **only ~24 banks**
  (no OPay/Moniepoint/Kuda), and we could not confirm from docs it is enabled by
  default — needs a Paystack support check. Same fee, more friction.

So card recurring is the first rail. The data model (below) uses a neutral
`channel` field so a Direct Debit rail can be added later without reshaping it.

### D7 detail — daily plans debited daily
Owner decision (2026-10-31): a daily plan is debited every day for one day's
contribution (`dailyAmount`), overriding the earlier recommendation to batch daily
plans into weekly debits. The trade-off we accept: card repeat charges can trigger bank
2FA (GTB/Access/UBA/Zenith/First can return `paused: true` + an `authorization_url`,
which breaks unattended debit) and tiny daily debits fail more often on a low-balance
audience, so the failure surface is higher than with weekly batching. Weekly and
monthly plans debit on their own cadence.

---

## Data model (new)

One new Prisma model; migration is additive (SQLite `RedefineTables`, data-safe), no
column drops.

```prisma
model AutoDebitMandate {
  id                 String   @id @default(cuid())
  customerId         String
  savingsPlanId      String   @unique      // one active mandate per plan
  channel            String   @default("card") // "card" | "direct_debit"
  authorizationCode  String                 // SECRET — can charge the card
  authSignature      String                 // Paystack `signature`, dedupe same card
  authEmail          String                 // email locked at authorization; only it can charge
  reusable           Boolean  @default(false)
  // masked display only — never the PAN/CVV/PIN
  last4              String?
  cardType           String?
  bankName           String?
  expMonth           String?
  expYear            String?
  status             String   @default("pending") // pending | active | paused | cancelled
  amountPerCycle     Float                   // the plan contribution C (naira)
  nextRunAt          DateTime
  consecutiveFailures Int     @default(0)
  consentAt          DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

- `authorizationCode` is a **secret**: never selected into list endpoints, responses,
  session/JWT payloads, or logs (consistent with `.claude/rules/database.md` on not
  putting sensitive values in payloads). It is read only by the server charge path.
- **Never stored anywhere:** full card number (PAN), CVV, PIN, OTPs, secret keys.
  Paystack never returns them.
- Each debit attempt reuses the existing `Transaction` table: a `saving` row on
  **confirmed settlement only**, with a **deterministic unique `ref`** =
  `autodebit-{planId}-{yyyymmdd}` (`Transaction.ref` is already `@unique`), which is
  our idempotency key — credit at most once per plan per scheduled day.

A second new model tracks each charge attempt (D10/D11), so a `processing` charge is
reconcilable and the actual money charged is on record:

```prisma
model AutoDebitAttempt {
  id             String   @id @default(cuid())
  mandateId      String
  savingsPlanId  String
  reference      String   @unique   // == the Transaction ref charged to Paystack
  cycleDate      DateTime            // the scheduled cadence day this attempt funds
  creditAmount   Float               // dailyAmount (C) — what the plan is credited on success
  grossCharged   Float               // grossed-up amount sent to the card (D5)
  feeEstimate    Float               // our estimated Paystack fee
  settledAmount  Float?              // actual amount Paystack settled (from verify), for disputes
  status         String   @default("pending") // pending | processing | success | failed
  gatewayResponse String?            // e.g. "Insufficient Funds" — never a secret
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Both new models are additive (SQLite `RedefineTables`, data-safe); add them in **one
forward-only migration** per `docs/migration-baseline.md`, never a casual `migrate dev`
against real data.

---

## Flows

### 1. Enrollment / consent (customer app)
1. On a plan, customer taps "Automate this savings."
2. We initialize a first card charge (Paystack's min ₦50; applied to the plan or
   refunded — builder picks, note it to the customer) so the customer 2FA-authorizes
   and we receive a reusable `authorization` object. Only proceed if
   `authorization.reusable === true`.
3. Store an `AutoDebitMandate` (status `active`), record `consentAt`, set `nextRunAt`
   to the next cadence boundary, show a clear "auto-debit on, cancel anytime" state.
4. Verify-before-store via `GET /transaction/verify/:reference` (don't trust the
   client redirect).

### 2. Scheduled debit (reuse `GET /api/cron/daily`)
Add two steps to the existing daily cron.

**(a) Fire due debits:**
- Select mandates where `status='active'` and `nextRunAt <= now` **and the plan is
  still `Active` and before `maturityDate`** (D8). A mandate whose plan has reached
  maturity is marked done and skipped — auto-debit never fires on/after maturity.
- Compute this cycle's `creditAmount` = `plan.dailyAmount` for every cadence (one
  contribution per cycle; no pro-rating needed since daily plans debit daily) and 0
  on/after maturity (D8/D9); compute
  `grossCharged` from the fee gross-up (D5/D11).
- Build `ref = autodebit-{planId}-{yyyymmdd}`; if a `Transaction` **or**
  `AutoDebitAttempt` with that `ref` exists, skip (idempotent).
- Write an `AutoDebitAttempt` (`status='processing'`) recording `creditAmount`,
  `grossCharged`, `feeEstimate`, `cycleDate`.
- Call `POST /transaction/charge_authorization` with `authorization_code`, the locked
  `email`, `grossCharged` in **kobo**, `currency: 'NGN'` (always explicit), unique
  `reference=ref`, and `metadata` tying it to `{customerId, planId}`.
- Do **not** credit yet — the response is often `processing`. Advance `nextRunAt` to
  the next cadence boundary.
- Keep transactions short (SQLite cluster write-contention): the cron does the API
  call and a small status write; crediting happens in the webhook or the sweep.

**(b) Reconcile stuck attempts (D10):** for each `AutoDebitAttempt` still
`processing` older than a threshold (builder default, e.g. 2h), call
`GET /transaction/verify/:reference`; route a `success` through the same idempotent
credit path as the webhook, and a confirmed failure through the failure path below.
This covers charges that never produce a webhook, so a customer is never debited
without either a credit or a recorded, counted failure.

### 3. Settlement (reuse the existing webhook)
- Reuse `src/app/api/paystack/webhook/route.ts` (**confirm this is the URL Paystack is
  configured to call** — there are two handlers; see `.claude/rules/backend-api.md`).
- Verify `x-paystack-signature` = HMAC-SHA512 of the **raw body** with the secret,
  using `crypto.timingSafeEqual`; reject an empty secret (fail closed).
- On `charge.success` whose `reference` matches an auto-debit ref: **re-verify** via
  `GET /transaction/verify/:reference`, check status `success` and that
  amount/currency/customer match the `AutoDebitAttempt`, then run the **one shared,
  idempotent credit path** (used by both webhook and the cron sweep) — **atomically**
  (one `prisma.$transaction`): create the `saving` Transaction (amount =
  `attempt.creditAmount`, `status:'Done'`, `agentId` = the plan's owning agent — same
  attribution a self-service deposit uses, since `Transaction.agentId` is required),
  increment `savingsPlan.balance`, set `attempt.status='success'` and
  `attempt.settledAmount` (from verify), reset `mandate.consecutiveFailures=0`,
  `logAudit`.
- Dedupe on the `ref` (the unique constraint on both `Transaction.ref` and
  `AutoDebitAttempt.reference` makes a replayed webhook / double sweep a no-op).
- Return `200` fast; Paystack retries every 3 min then hourly for 72h.

### 4. Failure & retry (D4)
- A charge that doesn't settle (read `gateway_response`, e.g. "Insufficient Funds"):
  increment `consecutiveFailures`, schedule a near-term retry (next day) for
  funds-type failures.
- **Expired / invalid card** → do not retry; set `status='paused'`, notify the
  customer to re-authorize (re-tokenize).
- After **N consecutive failures** (builder default, e.g. 3) → `status='paused'`,
  notify (reuse the Feature 3 email/SMS channels), leave the **plan Active**. The
  customer re-enables by re-authorizing.

### 5. Cancellation (D2)
- Customer taps "Turn off auto-debit": set `status='cancelled'`, stop scheduling, and
  call Paystack `POST /customer/authorization/deactivate` for the stored
  authorization. Confirm in the UI. (For a future Direct Debit rail, mandate
  revocation may require Paystack support — note at that time.)

---

## Constraints & security

- **Server-side authorization only**: the customer is derived from the JWT; every
  mandate/plan lookup is scoped `{ id, ... , customer }`-owned, 404 otherwise (IDOR).
- **Idempotency** on the deterministic `ref` is the backbone — one credit per plan
  per scheduled day, replay-safe webhook.
- **No new `any`**; keep `npx tsc --noEmit` at its baseline. TDD the fee gross-up,
  the schedule/`nextRunAt` advance, the idempotent credit, and the webhook
  verify-before-credit (mock Paystack HTTP; assert real DB effects).
- Reuse `money()` for all naira; kobo conversion only at the Paystack boundary.
- KudiSMS/email notifications only actually send with `NODE_ENV=production`.

## Ops / handover (one-time, after build)
- The daily `crontab` + `CRON_SECRET` from Features 1 & 3 are a prerequisite (this
  reuses that cron). No new infra beyond that.
- Confirm with Paystack: webhook URL in use, and (only if/when adding the Direct Debit
  rail) whether Direct Debit is enabled on the account.

---

## Calls I made while you slept (review in the morning — none block the build)
The owner approved the design and said to build overnight, so the builder-check's
open questions were settled conservatively rather than waiting:
- **D8 — termination:** auto-debit stops at `maturityDate` (no debit on/after it),
  never debits past the committed term. (If you'd rather it run until the goal
  amount is hit, or keep going until cancelled, say so — it's a one-line rule change.)
- **D9 — per-cycle amount = `dailyAmount`** for every cadence, once per cycle (grounded in the existing
  manual-deposit code, not guessed).
- **D11 — fee residual** absorbed by the merchant exactly like today's manual deposit;
  plan credited the full contribution; actual charged/settled amounts recorded.
- **D7 — daily plans debited daily** (owner decision 2026-10-31, overriding the earlier
  weekly-batching recommendation).
- **First-charge handling:** the ₦50 authorization charge is **applied to the plan**
  (customer loses nothing), not refunded.

Everything else (field names, retry count N, exact kobo rounding, which cron step,
UI copy, and confirming which of the two webhook handlers Paystack calls) is left to
the builder within the decisions above.

## What's left to the builder
Schema + migration; `AutoDebitMandate` model; enrollment route + customer-app screen;
the cron debit step; the webhook credit path (reusing the existing handler); the
failure/retry/pause logic; cancellation; notifications; and the test suite. Plan it
with `superpowers:writing-plans` after this design is approved.
