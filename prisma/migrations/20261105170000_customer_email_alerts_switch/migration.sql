-- The customer's own on/off switch for sign-in and payment emails. On by default; it only acts once the email is verified.
ALTER TABLE "Customer" ADD COLUMN "emailAlertsOn" BOOLEAN NOT NULL DEFAULT true;

-- Undo the 20261105150000 backfill. It marked emails verified because a customer had a self-created plan, which does
-- not prove the address is theirs. Those rows all carry one round-second timestamp from that deploy (15:31-15:45 UTC on
-- 2026-11-05); a real code-verified sign-up stores a timestamp with milliseconds. Affected customers confirm their
-- email again from the prompt. DateTime is epoch milliseconds in this database.
UPDATE "Customer"
SET "emailVerifiedAt" = NULL
WHERE "emailVerifiedAt" >= 1793892660000 AND "emailVerifiedAt" <= 1793893500000
  AND "emailVerifiedAt" % 1000 = 0;
