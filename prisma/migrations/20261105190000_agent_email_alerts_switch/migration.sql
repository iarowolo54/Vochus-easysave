-- The agent's own on/off switch for sign-in and payment emails. On by default; it only acts on a verified email.
ALTER TABLE "Agent" ADD COLUMN "emailAlertsOn" BOOLEAN NOT NULL DEFAULT true;
