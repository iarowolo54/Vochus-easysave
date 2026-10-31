-- AlterTable (additive; no table redefine)
ALTER TABLE "InterestRate" ADD COLUMN "maxAmount" REAL;
ALTER TABLE "InterestRate" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
