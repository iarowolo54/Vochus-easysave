-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,
    CONSTRAINT "Department_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "StaffUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Department" ("createdAt", "description", "id", "name", "status") SELECT "createdAt", "description", "id", "name", "status" FROM "Department";
DROP TABLE "Department";
ALTER TABLE "new_Department" RENAME TO "Department";
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE TABLE "new_StaffUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Invited',
    "lastActiveAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roleId" TEXT,
    "departmentId" TEXT,
    "approvalPin" TEXT,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" DATETIME,
    CONSTRAINT "StaffUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StaffUser_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StaffUser" ("approvalPin", "createdAt", "email", "id", "lastActiveAt", "name", "password", "roleId", "status") SELECT "approvalPin", "createdAt", "email", "id", "lastActiveAt", "name", "password", "roleId", "status" FROM "StaffUser";
DROP TABLE "StaffUser";
ALTER TABLE "new_StaffUser" RENAME TO "StaffUser";
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill explicit membership from each existing staffer's role.
UPDATE "StaffUser" SET "departmentId" = (SELECT "departmentId" FROM "Role" WHERE "Role"."id" = "StaffUser"."roleId") WHERE "roleId" IS NOT NULL;
