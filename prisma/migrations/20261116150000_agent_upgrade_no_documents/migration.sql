-- DropIndex
DROP INDEX "AgentUpgradeDocument_requestId_docType_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AgentUpgradeDocument";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentUpgradeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "nin" TEXT NOT NULL,
    "bvn" TEXT,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nokName" TEXT NOT NULL,
    "nokPhone" TEXT NOT NULL,
    "pendingCustomerId" TEXT,
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
INSERT INTO "new_AgentUpgradeRequest" ("address", "agentId", "bvn", "createdAgentId", "customerId", "decidedAt", "decidedBy", "decidedById", "denyFix", "denyReason", "id", "lga", "nin", "nokName", "nokPhone", "pendingCustomerId", "state", "status", "submittedAt") SELECT "address", "agentId", "bvn", "createdAgentId", "customerId", "decidedAt", "decidedBy", "decidedById", "denyFix", "denyReason", "id", "lga", "nin", "nokName", "nokPhone", "pendingCustomerId", "state", "status", "submittedAt" FROM "AgentUpgradeRequest";
DROP TABLE "AgentUpgradeRequest";
ALTER TABLE "new_AgentUpgradeRequest" RENAME TO "AgentUpgradeRequest";
CREATE UNIQUE INDEX "AgentUpgradeRequest_pendingCustomerId_key" ON "AgentUpgradeRequest"("pendingCustomerId");
CREATE UNIQUE INDEX "AgentUpgradeRequest_createdAgentId_key" ON "AgentUpgradeRequest"("createdAgentId");
CREATE INDEX "AgentUpgradeRequest_status_submittedAt_idx" ON "AgentUpgradeRequest"("status", "submittedAt");
CREATE INDEX "AgentUpgradeRequest_agentId_status_idx" ON "AgentUpgradeRequest"("agentId", "status");
CREATE INDEX "AgentUpgradeRequest_customerId_idx" ON "AgentUpgradeRequest"("customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

