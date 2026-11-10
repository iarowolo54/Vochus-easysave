-- CreateTable
CREATE TABLE "AgentDocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" TEXT NOT NULL,
    "docApprovalStatus" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL,
    "replacedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedBy" TEXT NOT NULL,
    CONSTRAINT "AgentDocumentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentDocumentVersion_agentId_docType_idx" ON "AgentDocumentVersion"("agentId", "docType");
