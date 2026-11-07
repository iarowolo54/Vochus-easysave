# API routes (`src/app/api/**/route.ts`)

Next.js App Router route handlers. Each file exports `GET`/`POST`/etc.

## Conventions observed here

- Import the shared Prisma client from `src/lib/prisma.ts` (`import { prisma } from '@/lib/prisma'`) — never `new PrismaClient()` in a route.
- Get the actor from the matching auth helper (see `auth-security.md`) at the top of the handler; return 401 before doing anything else.
- Return `NextResponse.json(...)`. Use the right status (400 validation, 401 unauthenticated, 403 unauthorized, 404 not found/owned).
- Money errors use the helpers in `src/lib/wallet-guard.ts` (`assertSufficient`, `insufficientResponse`).
- Audit sensitive actions with `logAudit` from `src/lib/audit.ts`, inside the same transaction as the change where possible.

## Money movement

- All fee/commission math lives in `src/lib/wallet-rates.ts`. Don't re-derive rates inline — call it.
- Wrap any multi-row balance change in `prisma.$transaction([...])`.
- Guard balances against races with a **conditional** update, not read-then-write:
  `prisma.agent.updateMany({ where: { id, commissionBalance: { gte: amount } }, data: { commissionBalance: { decrement: amount } } })` and check the returned count before proceeding.

## Validation

- Validate and narrow request bodies before use; don't spread an untrusted body into `prisma.create`/`update` (mass-assignment).

## Known duplicate to resolve

There are two Paystack webhook handlers (`api/paystack/webhook`, `api/webhooks/paystack`). Confirm which one Paystack is configured to call before changing either.

## In-app notifications (agents and customers)

Every agent/customer notification is written at the moment the change happens, through **one catalogue**:
`src/lib/notifications.ts`. Never write the `Notification` table directly and never build notification text elsewhere.

- Call `notify(tx, notifications.<kind>({...}))` **inside the same transaction** as the change (or spread
  `notificationOps(prisma, …)` into a batch `$transaction([...])`). For a conditional `updateMany`, notify only when `count === 1`.
- **Tripwire:** `tests/notification-coverage.test.ts` fails if any write that changes a collection (`earlyRedemption`) or a
  withdrawal (`agentWithdrawal`), credits a plan (`creditPlanBalance`/`creditOpenPlan`), funds a wallet (`type: 'wallet_funding'`),
  creates a collection request (`createRedemptionWithUniqueCode`) or records a device (`deviceSession`) lacks, within the 3 lines
  above it, either `// notify: <catalogueName>` (and the file calls it) or `// notify: none — <reason>`. Decide deliberately;
  internal steps (Processing, AwaitingOTP, attempt counters) are `none` with a reason.
- **Safety net:** `src/lib/notification-sweep.ts`, run nightly from `/api/cron/daily`, rebuilds the last 48 h with the same dedupe
  keys and writes only what's missing, logging `notifications_backfilled` in the audit log when it had to. A non-zero count means
  a live path is missing — fix the path, don't rely on the net. New event kinds must be added to both the catalogue and the sweep.
- Text is built from typed facts only: never pass a code, OTP, token or password into a notification.

## Text messages (SMS cost money)

Owner's rule (Nov 2026): online customers are reached by email; SMS only when they have no confirmed email. Cash customers
get SMS for registration, the weekly alert (only with no email at all), collections, the roll-over code and a hand-approved
deposit receipt. Account-recovery codes fall back to SMS only when there is no confirmed email. Codes never go to an
unconfirmed email. Channel choices live in `src/lib/customer-channels.ts` (collections), `plan-reopen-code.ts`,
`unlock-otp.ts` and `payout-notify.ts`.

- **Tripwire:** `tests/sms-sites.test.ts` fails if any `sendSMS(` lacks a `// sms: <rule>` comment within the 3 lines above.
  A new SMS is a cost decision for the owner — ask before adding one.
