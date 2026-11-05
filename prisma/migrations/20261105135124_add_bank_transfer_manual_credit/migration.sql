-- AlterTable
ALTER TABLE "BankAlert" ADD COLUMN "resolvedAt" DATETIME;
ALTER TABLE "BankAlert" ADD COLUMN "resolvedBy" TEXT;
ALTER TABLE "BankAlert" ADD COLUMN "resolvedNote" TEXT;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "manualBy" TEXT;
ALTER TABLE "PaymentIntent" ADD COLUMN "manualNote" TEXT;
