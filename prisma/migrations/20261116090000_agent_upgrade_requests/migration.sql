-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "fromCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "convertedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "convertedToAgentId" TEXT;

-- CreateTable
CREATE TABLE "AgentUpgradeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AwaitingCustomer',
    "nin" TEXT NOT NULL,
    "bvn" TEXT,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nokName" TEXT NOT NULL,
    "nokPhone" TEXT NOT NULL,
    "pendingCustomerId" TEXT,
    "confirmBy" DATETIME NOT NULL,
    "customerConfirmedAt" DATETIME,
    "customerDeclinedAt" DATETIME,
    "denyReason" TEXT,
    "denyFix" TEXT,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "decidedById" TEXT,
    "createdAgentId" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentUpgradeRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentUpgradeRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentUpgradeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentUpgradeDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AgentUpgradeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentUpgradeRequest_pendingCustomerId_key" ON "AgentUpgradeRequest"("pendingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentUpgradeRequest_createdAgentId_key" ON "AgentUpgradeRequest"("createdAgentId");

-- CreateIndex
CREATE INDEX "AgentUpgradeRequest_status_submittedAt_idx" ON "AgentUpgradeRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AgentUpgradeRequest_agentId_status_idx" ON "AgentUpgradeRequest"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentUpgradeRequest_customerId_idx" ON "AgentUpgradeRequest"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentUpgradeDocument_requestId_docType_key" ON "AgentUpgradeDocument"("requestId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_fromCustomerId_key" ON "Agent"("fromCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_convertedToAgentId_key" ON "Customer"("convertedToAgentId");

