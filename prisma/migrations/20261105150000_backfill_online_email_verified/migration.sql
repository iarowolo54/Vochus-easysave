-- Online customers registered themselves with an emailed code, but accounts made before "emailVerifiedAt" existed
-- have it empty, so they miss sign-in alerts and email recovery. Mark those addresses verified.
-- Offline customers (email typed in by an agent, no self-created plan) are left alone.
-- DateTime is stored as epoch milliseconds in this database.
UPDATE "Customer"
SET "emailVerifiedAt" = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE "emailVerifiedAt" IS NULL
  AND "email" IS NOT NULL AND TRIM("email") <> ''
  AND EXISTS (SELECT 1 FROM "SavingsPlan" p WHERE p."customerId" = "Customer"."id" AND p."source" = 'self');
