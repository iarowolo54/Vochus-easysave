# Prisma migration baseline runbook (#9)

**Audience:** an engineer doing this deliberately, against a copy first.
**Do NOT run `prisma migrate dev` on this repo casually** — see "Why" below.

## Current state (2026-10-29)
- `prisma/migrations/` has 5 committed migrations, newest
  `20261018000000_add_savingsplan_source`. They are **stale**: they do not include
  `EmailOTP.attempts`, or the `LoginAttempt` / `AccountUnlockOtp` / `PaymentIntent`
  models, and one of them (`20260722125138_add_savingsplan_unique`) **adds** the
  `(customerId, startDate)` unique index that has since been **dropped** from the
  schema and from prod.
- **No database is migration-tracked.** prod, staging and local `dev.db` were all
  built and kept in sync with `prisma db push` (deploy runs
  `db push --accept-data-loss` — see `.claude/rules/database.md`). None has a
  `_prisma_migrations` table.
- Net effect: the live schema (from `db push`) and the migrations history have
  diverged, and Prisma has no record of what's "applied" anywhere.

## Why `migrate dev` is dangerous here
`migrate dev` builds a **shadow DB from the migrations history** and diffs it
against `schema.prisma`. Because no DB records applied migrations, and the history
is stale, Prisma can decide the whole history needs (re)applying, or generate a
"fix" migration that includes destructive statements. A prior attempt on this repo
generated a migration that would have **dropped the `Loan` table**. Never let an
auto-generated migration run against prod unreviewed.

## Safe baseline procedure (one-time, reviewed)
Do every step against a **copy** of prod first. Back up prod (`~/db-backups`, and
the deploy's own predeploy backup) before touching it.

1. **Snapshot a prod copy locally.** Pull a recent `~/db-backups/*.db.gz`, gunzip
   to a scratch file, confirm `pragma integrity_check;` = ok.

2. **Generate a catch-up migration** that brings the migrations history up to the
   current schema (adds the new models/column, drops the obsolete unique index):

   ```bash
   TS=$(date -u +%Y%m%d%H%M%S)
   mkdir -p prisma/migrations/${TS}_catchup_to_current
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/${TS}_catchup_to_current/migration.sql
   ```

   **Review the SQL by hand.** It must only: add `EmailOTP.attempts`; create
   `LoginAttempt`, `AccountUnlockOtp`, `PaymentIntent`; drop
   `SavingsPlan_customerId_startDate_key`. If it contains any `DROP TABLE` or
   column drops on tables with data (Loan, Agent, Customer, SavingsPlan, …), STOP
   and fix the schema/diff — that's the known failure mode.

3. **Baseline the existing DB** (the prod copy, then prod/staging) — tell Prisma
   the schema is already there without running anything. Point `DATABASE_URL` at
   the target DB, then mark every migration (the 5 originals **and** the catch-up)
   as already applied:

   ```bash
   for m in $(ls prisma/migrations | grep -v migration_lock.toml); do
     npx prisma migrate resolve --applied "$m"
   done
   npx prisma migrate status   # expect: "Database schema is up to date!"
   ```

   This creates `_prisma_migrations` and records each as applied. It does NOT run
   the SQL — which is correct, because `db push` already put the current schema in
   place. (The datasource is hardcoded to `file:./dev.db`; set the working copy
   up so that path resolves to the DB you're baselining.)

4. **Commit** the catch-up migration. From here, new schema changes use
   `npx prisma migrate dev --name <what>` locally, producing one reviewed SQL file
   per change (the project rule).

5. **Switch the deploy** from `prisma db push --accept-data-loss` to
   `prisma migrate deploy` in `scripts/deploy.sh` and `deploy-staging.sh` — as its
   **own** change, validated on staging first. `migrate deploy` only applies
   pending, committed migrations and never prompts for data loss, which removes the
   standing deploy risk noted in `database.md`.

## Until this is done
Keep shipping schema via `db push` / targeted additive DDL (the pattern used for
`EmailOTP.attempts` and the `SavingsPlan` index drop): apply the change to each
env's DB manually (additive only), deploy code-only, and never run the deploy's
`ALLOW_DB_PUSH` path against drifted data. See [[schema-ships-via-db-push]].
