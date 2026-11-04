-- CreateTable
CREATE TABLE "BankAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "senderName" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "alertAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "intentRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaymentIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "agentId" TEXT,
    "customerId" TEXT,
    "planId" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME,
    "coversKeys" TEXT,
    "method" TEXT NOT NULL DEFAULT 'paystack',
    "expiresAt" DATETIME
);
INSERT INTO "new_PaymentIntent" ("actorType", "agentId", "amount", "consumedAt", "coversKeys", "createdAt", "currency", "customerId", "id", "planId", "ref", "status") SELECT "actorType", "agentId", "amount", "consumedAt", "coversKeys", "createdAt", "currency", "customerId", "id", "planId", "ref", "status" FROM "PaymentIntent";
DROP TABLE "PaymentIntent";
ALTER TABLE "new_PaymentIntent" RENAME TO "PaymentIntent";
CREATE UNIQUE INDEX "PaymentIntent_ref_key" ON "PaymentIntent"("ref");
CREATE INDEX "PaymentIntent_customerId_idx" ON "PaymentIntent"("customerId");
CREATE INDEX "PaymentIntent_agentId_idx" ON "PaymentIntent"("agentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BankAlert_messageId_key" ON "BankAlert"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAlert_txnId_key" ON "BankAlert"("txnId");
