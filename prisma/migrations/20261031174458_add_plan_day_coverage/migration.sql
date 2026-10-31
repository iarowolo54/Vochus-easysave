-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "coversKeys" TEXT;

-- CreateTable
CREATE TABLE "PlanDayCoverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "savingsPlanId" TEXT NOT NULL,
    "coversKey" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanDayCoverage_savingsPlanId_fkey" FOREIGN KEY ("savingsPlanId") REFERENCES "SavingsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanDayCoverage_savingsPlanId_coversKey_key" ON "PlanDayCoverage"("savingsPlanId", "coversKey");
