-- Customer: make agentId nullable + add referredBy, kind
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "referredBy" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'Savings',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "dob" DATETIME,
    "address" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "bvn" TEXT,
    "nokName" TEXT NOT NULL,
    "nokRelation" TEXT NOT NULL,
    "nokPhone" TEXT NOT NULL,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "password" TEXT,
    "inviteToken" TEXT,
    "boundDeviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_referredBy_fkey" FOREIGN KEY ("referredBy") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("id","customerId","agentId","firstName","lastName","phone","email","dob","address","language","bvn","nokName","nokRelation","nokPhone","photoUrl","status","password","inviteToken","boundDeviceId","createdAt")
SELECT "id","customerId","agentId","firstName","lastName","phone","email","dob","address","language","bvn","nokName","nokRelation","nokPhone","photoUrl","status","password","inviteToken","boundDeviceId","createdAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_customerId_key" ON "Customer"("customerId");
CREATE UNIQUE INDEX "Customer_inviteToken_key" ON "Customer"("inviteToken");

PRAGMA foreign_keys=ON;

-- GiftCardCategory
CREATE TABLE "GiftCardCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "denominations" TEXT NOT NULL DEFAULT '[]',
    "productionCost" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GiftCardCategory_name_key" ON "GiftCardCategory"("name");

-- GiftCardOrder
CREATE TABLE "GiftCardOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "loadedAmount" REAL NOT NULL,
    "productionCost" REAL NOT NULL,
    "totalPaid" REAL NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PendingPayment',
    "paystackRef" TEXT,
    "paidAt" DATETIME,
    "producedAt" DATETIME,
    "producedBy" TEXT,
    "shippedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCardOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GiftCardOrder_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GiftCardCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GiftCardOrder_ref_key" ON "GiftCardOrder"("ref");
CREATE UNIQUE INDEX "GiftCardOrder_paystackRef_key" ON "GiftCardOrder"("paystackRef");
CREATE INDEX "GiftCardOrder_status_idx" ON "GiftCardOrder"("status");
CREATE INDEX "GiftCardOrder_customerId_idx" ON "GiftCardOrder"("customerId");

-- GiftCard
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serial" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "issuerCustomerId" TEXT NOT NULL,
    "loadedAmount" REAL NOT NULL,
    "balance" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Produced',
    "redeemedByCustomerId" TEXT,
    "redeemedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCard_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GiftCardOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GiftCard_redeemedByCustomerId_fkey" FOREIGN KEY ("redeemedByCustomerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GiftCard_serial_key" ON "GiftCard"("serial");
CREATE UNIQUE INDEX "GiftCard_qrToken_key" ON "GiftCard"("qrToken");
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");
CREATE INDEX "GiftCard_issuerCustomerId_idx" ON "GiftCard"("issuerCustomerId");

-- GiftCardInvite
CREATE TABLE "GiftCardInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "GiftCardInvite_token_key" ON "GiftCardInvite"("token");
