-- AlterTable
ALTER TABLE "PasswordResetOtp" ADD COLUMN "resetId" TEXT;

-- CreateIndex
CREATE INDEX "PasswordResetOtp_resetId_idx" ON "PasswordResetOtp"("resetId");
