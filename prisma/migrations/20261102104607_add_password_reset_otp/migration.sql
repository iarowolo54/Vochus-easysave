-- AlterTable
-- A plain ADD COLUMN instead of Prisma's generated table rebuild: existing Customer rows are untouched.
ALTER TABLE "Customer" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PasswordResetOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PasswordResetOtp_actorType_actorId_createdAt_idx" ON "PasswordResetOtp"("actorType", "actorId", "createdAt");
