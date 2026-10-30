-- CreateTable
CREATE TABLE "ApprovalPinAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPinAttempt_adminId_key" ON "ApprovalPinAttempt"("adminId");
