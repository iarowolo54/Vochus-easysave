-- AlterTable
ALTER TABLE "PasswordResetOtp" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'reset';
