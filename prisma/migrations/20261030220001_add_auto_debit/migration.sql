-- CreateTable
CREATE TABLE "AutoDebitMandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "savingsPlanId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'card',
    "authorizationCode" TEXT NOT NULL,
    "authSignature" TEXT NOT NULL,
    "authEmail" TEXT NOT NULL,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "last4" TEXT,
    "cardType" TEXT,
    "bankName" TEXT,
    "expMonth" TEXT,
    "expYear" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amountPerCycle" REAL NOT NULL,
    "nextRunAt" DATETIME NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AutoDebitAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mandateId" TEXT NOT NULL,
    "savingsPlanId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "cycleDate" DATETIME NOT NULL,
    "creditAmount" REAL NOT NULL,
    "grossCharged" REAL NOT NULL,
    "feeEstimate" REAL NOT NULL,
    "settledAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gatewayResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AutoDebitMandate_savingsPlanId_key" ON "AutoDebitMandate"("savingsPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoDebitAttempt_reference_key" ON "AutoDebitAttempt"("reference");
