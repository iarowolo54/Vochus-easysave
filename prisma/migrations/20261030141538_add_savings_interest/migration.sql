-- CreateTable
CREATE TABLE "SavingsInterestRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annualRate" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EarlyRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "savingsPlanId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'early',
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "balance" REAL NOT NULL,
    "penalty" REAL NOT NULL DEFAULT 0,
    "interestAmount" REAL NOT NULL DEFAULT 0,
    "netPayout" REAL NOT NULL,
    "token" TEXT,
    "tokenExpiry" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "agentApprovedAt" DATETIME,
    "agentApprovedBy" TEXT,
    "payoutMethod" TEXT NOT NULL DEFAULT 'Cash',
    "accountNumber" TEXT,
    "accountName" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "paystackRecipientCode" TEXT,
    "paystackTransferCode" TEXT,
    "bankTransferStatus" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    CONSTRAINT "EarlyRedemption_savingsPlanId_fkey" FOREIGN KEY ("savingsPlanId") REFERENCES "SavingsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EarlyRedemption" ("accountName", "accountNumber", "agentApprovedAt", "agentApprovedBy", "attempts", "balance", "bankCode", "bankName", "bankTransferStatus", "decidedAt", "decidedBy", "id", "netPayout", "note", "payoutMethod", "paystackRecipientCode", "paystackTransferCode", "penalty", "reason", "ref", "requestedAt", "savingsPlanId", "status", "token", "tokenExpiry", "type") SELECT "accountName", "accountNumber", "agentApprovedAt", "agentApprovedBy", "attempts", "balance", "bankCode", "bankName", "bankTransferStatus", "decidedAt", "decidedBy", "id", "netPayout", "note", "payoutMethod", "paystackRecipientCode", "paystackTransferCode", "penalty", "reason", "ref", "requestedAt", "savingsPlanId", "status", "token", "tokenExpiry", "type" FROM "EarlyRedemption";
DROP TABLE "EarlyRedemption";
ALTER TABLE "new_EarlyRedemption" RENAME TO "EarlyRedemption";
CREATE UNIQUE INDEX "EarlyRedemption_ref_key" ON "EarlyRedemption"("ref");
CREATE UNIQUE INDEX "EarlyRedemption_token_key" ON "EarlyRedemption"("token");
CREATE TABLE "new_SavingsPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "dailyAmount" REAL NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'daily',
    "source" TEXT NOT NULL DEFAULT 'agent',
    "goal" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "maturityDate" DATETIME NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "maturityNotified" BOOLEAN NOT NULL DEFAULT false,
    "interestAccrued" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "SavingsPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SavingsPlan" ("balance", "cadence", "customerId", "dailyAmount", "goal", "id", "maturityDate", "maturityNotified", "notes", "periodDays", "source", "startDate", "status") SELECT "balance", "cadence", "customerId", "dailyAmount", "goal", "id", "maturityDate", "maturityNotified", "notes", "periodDays", "source", "startDate", "status" FROM "SavingsPlan";
DROP TABLE "SavingsPlan";
ALTER TABLE "new_SavingsPlan" RENAME TO "SavingsPlan";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
