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
