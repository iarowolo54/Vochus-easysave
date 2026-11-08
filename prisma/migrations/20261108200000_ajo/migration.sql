-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "ajoMemberId" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN "ajoRound" INTEGER;

-- CreateTable
CREATE TABLE "AjoGroup" (
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
    "lockedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjoGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AjoMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "slot" INTEGER,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjoMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AjoGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AjoMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AjoContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "agentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjoContribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AjoGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AjoContribution_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AjoMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AjoPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "savingsPlanId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjoPayout_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AjoGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AjoGroup_code_key" ON "AjoGroup"("code");

-- CreateIndex
CREATE INDEX "AjoGroup_agentId_idx" ON "AjoGroup"("agentId");

-- CreateIndex
CREATE INDEX "AjoMember_customerId_idx" ON "AjoMember"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "AjoMember_groupId_customerId_key" ON "AjoMember"("groupId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "AjoMember_groupId_slot_key" ON "AjoMember"("groupId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "AjoContribution_ref_key" ON "AjoContribution"("ref");

-- CreateIndex
CREATE INDEX "AjoContribution_groupId_round_idx" ON "AjoContribution"("groupId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "AjoContribution_memberId_round_key" ON "AjoContribution"("memberId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "AjoPayout_savingsPlanId_key" ON "AjoPayout"("savingsPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "AjoPayout_groupId_round_key" ON "AjoPayout"("groupId", "round");

