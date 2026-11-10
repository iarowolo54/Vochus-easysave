-- AlterTable
ALTER TABLE "AgentDocument" ADD COLUMN "uploadedBy" TEXT;

-- AlterTable
ALTER TABLE "AgentDocumentVersion" ADD COLUMN "uploadedBy" TEXT;
