-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AjoGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contribution" REAL NOT NULL,
    "startDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Forming',
    "feeRule" TEXT NOT NULL DEFAULT 'none',
    "feePct" REAL NOT NULL DEFAULT 0,
    "feeAgentSharePct" REAL NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "completedAt" DATETIME,
    "stoppedAt" DATETIME,
    "stopReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjoGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AjoGroup" ("agentId", "cadence", "code", "completedAt", "contribution", "createdAt", "feeRule", "id", "lockedAt", "name", "size", "startDate", "status", "stopReason", "stoppedAt") SELECT "agentId", "cadence", "code", "completedAt", "contribution", "createdAt", "feeRule", "id", "lockedAt", "name", "size", "startDate", "status", "stopReason", "stoppedAt" FROM "AjoGroup";
DROP TABLE "AjoGroup";
ALTER TABLE "new_AjoGroup" RENAME TO "AjoGroup";
CREATE UNIQUE INDEX "AjoGroup_code_key" ON "AjoGroup"("code");
CREATE INDEX "AjoGroup_agentId_idx" ON "AjoGroup"("agentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

