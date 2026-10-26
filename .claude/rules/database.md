# Database (Prisma + SQLite)

- Schema: `prisma/schema.prisma`. The datasource URL is hardcoded to `file:./dev.db` (the `DATABASE_URL` env var is not actually used), so local and production both run on a file named `dev.db`.
- After any schema change: `npx prisma migrate dev --name <what>` then restart the dev server. Run `npx prisma generate` after `npm install` or a schema edit.
- **Migrations are forward-only.** Never edit an applied/committed migration in `prisma/migrations/`; add a new one. (A hook blocks editing committed migration SQL.)
- **Never** `prisma migrate reset` or `prisma db push --accept-data-loss` against data you care about — both can wipe/drop. (A hook blocks these via Bash.)
- `AuditLog` is **append-only** — never update/delete/truncate it.

## SQLite realities

- Production runs **2 PM2 cluster instances against one SQLite file**, so concurrent writes can hit "database is locked". Keep transactions short; avoid writes inside long loops.
- Base64 blobs are stored in columns (`Agent.photoUrl`, `AgentDocument.fileData`, etc.). Don't `select` these into list endpoints or JWT/session payloads.

## Deploy caveat

The deploy scripts run `prisma db push --accept-data-loss` and the seed on every deploy — that is a known risk, not a pattern to copy. The nightly backup is `~/db-backups` on the server (cron, 2am, 14-day retention).

## Money type

Balances/amounts are `Float` in the schema (an existing decision). Round with `money()` from `src/lib/wallet-guard.ts` when comparing or displaying; don't introduce new float-rounding logic ad hoc.
