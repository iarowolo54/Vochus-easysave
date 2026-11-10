-- CreateTable
CREATE TABLE "CustomerRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "dob" DATETIME,
    "address" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "gender" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "bvn" TEXT,
    "nokName" TEXT NOT NULL DEFAULT '',
    "nokRelation" TEXT NOT NULL DEFAULT '',
    "nokPhone" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT,
    "plans" TEXT NOT NULL,
    "nfcCard" TEXT,
    "registrationFee" REAL NOT NULL,
    "pendingPhone" TEXT,
    "pendingEmail" TEXT,
    "denyReason" TEXT,
    "denyFix" TEXT,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "decidedById" TEXT,
    "customerCode" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_pendingPhone_key" ON "CustomerRequest"("pendingPhone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_pendingEmail_key" ON "CustomerRequest"("pendingEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_customerCode_key" ON "CustomerRequest"("customerCode");

-- CreateIndex
CREATE INDEX "CustomerRequest_status_submittedAt_idx" ON "CustomerRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "CustomerRequest_agentId_status_idx" ON "CustomerRequest"("agentId", "status");
