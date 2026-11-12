-- Customer type, decided by who registered the customer: online = registered themselves, offline = registered by an agent.
-- A single added column (no table rebuild), so live rows are untouched.
ALTER TABLE "Customer" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'offline';

-- Backfill with the rule the app used until now (online if any plan is self-service), so no customer's label
-- changes on deploy. Customers the owner confirmed were already corrected by hand on 2026-11-11/12.
UPDATE "Customer" SET "type" = 'online' WHERE "id" IN (SELECT "customerId" FROM "SavingsPlan" WHERE "source" = 'self');
