-- AlterTable
ALTER TABLE "EarlyRedemption" ADD COLUMN "feeRule" TEXT NOT NULL DEFAULT 'v1';

-- CreateTable
CREATE TABLE "CommissionLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "party" TEXT NOT NULL,
    "agentId" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "customerId" TEXT,
    "base" REAL NOT NULL,
    "ratePct" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CommissionLedger_agentId_createdAt_idx" ON "CommissionLedger"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommissionLedger_party_createdAt_idx" ON "CommissionLedger"("party", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionLedger_source_sourceRef_party_key" ON "CommissionLedger"("source", "sourceRef", "party");
