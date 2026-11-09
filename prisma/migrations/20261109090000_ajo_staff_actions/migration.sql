-- AlterTable
ALTER TABLE "AjoGroup" ADD COLUMN "stopReason" TEXT;
ALTER TABLE "AjoGroup" ADD COLUMN "stoppedAt" DATETIME;

-- AlterTable
ALTER TABLE "AjoContribution" ADD COLUMN "refundPlanId" TEXT;
ALTER TABLE "AjoContribution" ADD COLUMN "refundedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AjoMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "slot" INTEGER,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owedToCustomerId" TEXT,
    "owedAmount" REAL NOT NULL DEFAULT 0,
    "replacedAt" DATETIME,
    CONSTRAINT "AjoMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AjoGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AjoMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AjoMember" ("customerId", "groupId", "id", "joinedAt", "slot") SELECT "customerId", "groupId", "id", "joinedAt", "slot" FROM "AjoMember";
DROP TABLE "AjoMember";
ALTER TABLE "new_AjoMember" RENAME TO "AjoMember";
CREATE INDEX "AjoMember_customerId_idx" ON "AjoMember"("customerId");
CREATE UNIQUE INDEX "AjoMember_groupId_customerId_key" ON "AjoMember"("groupId", "customerId");
CREATE UNIQUE INDEX "AjoMember_groupId_slot_key" ON "AjoMember"("groupId", "slot");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

