-- CreateTable
CREATE TABLE "CustomerPhotoRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "photoUrl" TEXT,
    "rejectReason" TEXT,
    "pendingCustomerId" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "decidedById" TEXT,
    CONSTRAINT "CustomerPhotoRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerPhotoRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPhotoRequest_pendingCustomerId_key" ON "CustomerPhotoRequest"("pendingCustomerId");

-- CreateIndex
CREATE INDEX "CustomerPhotoRequest_status_submittedAt_idx" ON "CustomerPhotoRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "CustomerPhotoRequest_customerId_status_idx" ON "CustomerPhotoRequest"("customerId", "status");
