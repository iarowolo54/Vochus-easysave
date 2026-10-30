-- DropIndex
DROP INDEX "SavingsPlan_customerId_startDate_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "gender" TEXT;
ALTER TABLE "Customer" ADD COLUMN "lga" TEXT;
ALTER TABLE "Customer" ADD COLUMN "state" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "walletAfter" REAL;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BiometricToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT,
    "customerId" TEXT,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "agentId" TEXT,
    "customerId" TEXT,
    "platform" TEXT,
    "model" TEXT,
    "manufacturer" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "ipAddress" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginCount" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "AgentWithdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "payoutMethod" TEXT NOT NULL DEFAULT 'BankTransfer',
    "bankCode" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "paystackRecipientCode" TEXT,
    "paystackTransferCode" TEXT,
    "bankTransferStatus" TEXT,
    "adminNote" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT
);

-- CreateTable
CREATE TABLE "RewardPromo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Registration Reward',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "offlineRewardAmount" REAL NOT NULL DEFAULT 200,
    "onlineRewardAmount" REAL NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentReward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "narration" TEXT NOT NULL DEFAULT 'Reward fee',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentReward_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentReward_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentReward_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "RewardPromo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailAt" DATETIME,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountUnlockOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "agentId" TEXT,
    "customerId" TEXT,
    "planId" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "address" TEXT,
    "dob" TEXT,
    "gender" TEXT,
    "bvn" TEXT,
    "nin" TEXT,
    "nokName" TEXT,
    "nokPhone" TEXT,
    "photoUrl" TEXT,
    "nfcCard" TEXT,
    "floatLimit" REAL,
    "password" TEXT NOT NULL,
    "walletBalance" REAL NOT NULL DEFAULT 0,
    "commissionBalance" REAL NOT NULL DEFAULT 0,
    "requiredDocs" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "profileUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "transactionPin" TEXT,
    "unlockToken" TEXT,
    "unlockTokenExpiry" DATETIME,
    "boundDeviceId" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Agent" ("address", "agentId", "bvn", "commissionBalance", "createdAt", "dob", "email", "emailVerified", "emailVerifyToken", "floatLimit", "gender", "id", "location", "lockedAt", "loginAttempts", "name", "nfcCard", "nin", "nokName", "nokPhone", "password", "phone", "photoUrl", "profileUnlocked", "requiredDocs", "status", "transactionPin", "unlockToken", "unlockTokenExpiry", "walletBalance") SELECT "address", "agentId", "bvn", "commissionBalance", "createdAt", "dob", "email", "emailVerified", "emailVerifyToken", "floatLimit", "gender", "id", "location", "lockedAt", "loginAttempts", "name", "nfcCard", "nin", "nokName", "nokPhone", "password", "phone", "photoUrl", "profileUnlocked", "requiredDocs", "status", "transactionPin", "unlockToken", "unlockTokenExpiry", "walletBalance" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_agentId_key" ON "Agent"("agentId");
CREATE UNIQUE INDEX "Agent_phone_key" ON "Agent"("phone");
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email");
CREATE UNIQUE INDEX "Agent_emailVerifyToken_key" ON "Agent"("emailVerifyToken");
CREATE TABLE "new_EarlyRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "savingsPlanId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'early',
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "balance" REAL NOT NULL,
    "penalty" REAL NOT NULL DEFAULT 0,
    "netPayout" REAL NOT NULL,
    "token" TEXT,
    "tokenExpiry" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "agentApprovedAt" DATETIME,
    "agentApprovedBy" TEXT,
    "payoutMethod" TEXT NOT NULL DEFAULT 'Cash',
    "accountNumber" TEXT,
    "accountName" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "paystackRecipientCode" TEXT,
    "paystackTransferCode" TEXT,
    "bankTransferStatus" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    CONSTRAINT "EarlyRedemption_savingsPlanId_fkey" FOREIGN KEY ("savingsPlanId") REFERENCES "SavingsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EarlyRedemption" ("accountName", "accountNumber", "agentApprovedAt", "agentApprovedBy", "balance", "bankCode", "bankName", "bankTransferStatus", "decidedAt", "decidedBy", "id", "netPayout", "note", "payoutMethod", "paystackRecipientCode", "paystackTransferCode", "penalty", "reason", "ref", "requestedAt", "savingsPlanId", "status", "token", "tokenExpiry", "type") SELECT "accountName", "accountNumber", "agentApprovedAt", "agentApprovedBy", "balance", "bankCode", "bankName", "bankTransferStatus", "decidedAt", "decidedBy", "id", "netPayout", "note", "payoutMethod", "paystackRecipientCode", "paystackTransferCode", "penalty", "reason", "ref", "requestedAt", "savingsPlanId", "status", "token", "tokenExpiry", "type" FROM "EarlyRedemption";
DROP TABLE "EarlyRedemption";
ALTER TABLE "new_EarlyRedemption" RENAME TO "EarlyRedemption";
CREATE UNIQUE INDEX "EarlyRedemption_ref_key" ON "EarlyRedemption"("ref");
CREATE UNIQUE INDEX "EarlyRedemption_token_key" ON "EarlyRedemption"("token");
CREATE TABLE "new_EmailOTP" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_EmailOTP" ("code", "createdAt", "email", "expiresAt", "id", "verified") SELECT "code", "createdAt", "email", "expiresAt", "id", "verified" FROM "EmailOTP";
DROP TABLE "EmailOTP";
ALTER TABLE "new_EmailOTP" RENAME TO "EmailOTP";
CREATE TABLE "new_Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "customerId" TEXT,
    "principal" REAL NOT NULL,
    "interestRate" REAL NOT NULL,
    "interestAmount" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Loan_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Loan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Loan" ("agentId", "approvedBy", "createdAt", "customerId", "dueDate", "durationDays", "id", "interestAmount", "interestRate", "principal", "ref", "status", "totalAmount") SELECT "agentId", "approvedBy", "createdAt", "customerId", "dueDate", "durationDays", "id", "interestAmount", "interestRate", "principal", "ref", "status", "totalAmount" FROM "Loan";
DROP TABLE "Loan";
ALTER TABLE "new_Loan" RENAME TO "Loan";
CREATE UNIQUE INDEX "Loan_ref_key" ON "Loan"("ref");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BiometricToken_agentId_deviceId_idx" ON "BiometricToken"("agentId", "deviceId");

-- CreateIndex
CREATE INDEX "BiometricToken_customerId_deviceId_idx" ON "BiometricToken"("customerId", "deviceId");

-- CreateIndex
CREATE INDEX "BiometricToken_tokenHash_idx" ON "BiometricToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceSession_agentId_idx" ON "DeviceSession"("agentId");

-- CreateIndex
CREATE INDEX "DeviceSession_customerId_idx" ON "DeviceSession"("customerId");

-- CreateIndex
CREATE INDEX "DeviceSession_lastSeenAt_idx" ON "DeviceSession"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSession_deviceId_app_key" ON "DeviceSession"("deviceId", "app");

-- CreateIndex
CREATE UNIQUE INDEX "AgentWithdrawal_ref_key" ON "AgentWithdrawal"("ref");

-- CreateIndex
CREATE INDEX "AgentWithdrawal_agentId_idx" ON "AgentWithdrawal"("agentId");

-- CreateIndex
CREATE INDEX "AgentWithdrawal_status_idx" ON "AgentWithdrawal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentReward_customerId_key" ON "AgentReward"("customerId");

-- CreateIndex
CREATE INDEX "AgentReward_agentId_idx" ON "AgentReward"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_key_key" ON "LoginAttempt"("key");

-- CreateIndex
CREATE INDEX "AccountUnlockOtp_customerId_idx" ON "AccountUnlockOtp"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_ref_key" ON "PaymentIntent"("ref");

-- CreateIndex
CREATE INDEX "PaymentIntent_customerId_idx" ON "PaymentIntent"("customerId");

-- CreateIndex
CREATE INDEX "PaymentIntent_agentId_idx" ON "PaymentIntent"("agentId");

