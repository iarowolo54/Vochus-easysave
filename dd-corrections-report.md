# Direct-debit corrections report

## Change A - real webhook handler
- `src/app/api/webhooks/paystack/route.ts`: after the charge.success guard, `autodebit-` refs now re-verify via verifyTransaction (status success; amount/currency only cross-checked when verified amount > 0), then creditAutoDebitAttempt with settled = verified amount or attempt.grossCharged. try/catch, always 200, no auth code logged. Runs before the generic self-pay branch; `addenroll-` refs still fall through to it.
- `src/app/api/paystack/webhook/route.ts`: auto-debit block, its imports and the stale NOTE removed; file is identical to its pre-Task-12 state (transfer.* untouched).
- Test: `tests/auto-debit-webhook.int.test.ts` renamed to `tests/auto-debit-webhook-real.int.test.ts`, retargeted at the real route. Covers bad sig 401 no credit, generic self-pay (VCHS- ref) still credits gross, stray autodebit- ref no-op, valid autodebit credits creditAmount 700 (not gross 710) and replay stays one credit.
- RED: 2 failures (stray ref credited via generic branch; attempt stayed 'processing'). GREEN: 4/4.

## Change B - daily is daily
- `src/lib/auto-debit-schedule.ts`: AutoDebitCadence widened; daily->daily; nextRunAt daily +1 day; cycleCreditAmount = money(dailyAmount) for all cadences, 0 on/after maturity. Callers (auto-debit.ts, auto-debit-run.ts) compile unchanged.
- `tests/auto-debit-schedule.test.ts` updated per spec. RED: 3 failures. GREEN after change.
- Design doc: D7 rewritten (owner decision 2026-10-31), D9/D8 pro-rating notes reconciled.
- Existing test fixed: `tests/auto-debit-mandate.int.test.ts` asserted first nextRunAt > 6 days (weekly assumption for a daily plan); now asserts ~1 day. Cron tests needed no change (they use weekly plans).

## Results
- Full suite: 323 tests, 323 pass, 0 fail.
- tsc --noEmit: 23 errors (unchanged).

## Concerns
- Daily mandates now fire every day: higher bank-2FA/failure exposure (documented in D7).
- Existing mandates already stored with weekly nextRunAt are not migrated; daily-plan mandates created before this change will keep their old nextRunAt until next advance.
