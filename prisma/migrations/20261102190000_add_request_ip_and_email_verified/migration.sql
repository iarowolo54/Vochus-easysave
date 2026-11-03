-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "emailVerifiedAt" DATETIME;

-- AlterTable
ALTER TABLE "PasswordResetOtp" ADD COLUMN "requestIpHash" TEXT;
