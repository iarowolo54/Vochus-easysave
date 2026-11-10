-- CreateTable
CREATE TABLE "AnnouncementImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mime" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementImage_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AnnouncementImage_announcementId_position_idx" ON "AnnouncementImage"("announcementId", "position");
