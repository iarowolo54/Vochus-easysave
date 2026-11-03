-- AlterTable
ALTER TABLE "SavingsPlan" ADD COLUMN "feeCollected" REAL NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "feeTaken" REAL NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EarlyRedemption" ADD COLUMN "feeAgent" REAL NOT NULL DEFAULT 0;
