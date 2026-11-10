import { prisma } from '@/lib/prisma'

/** Puts a file in place for an agent's document. Whatever it overwrites is kept as an earlier file, in the same transaction. */
export async function saveAgentDocument(input: {
  agentId: string
  docType: string
  fileName: string
  fileData: string
  replacedBy: string
  statusFor: (previous: string | undefined) => string
}) {
  const { agentId, docType, fileName, fileData, replacedBy, statusFor } = input
  const key = { agentId_docType: { agentId, docType } }
  return prisma.$transaction(async tx => {
    const existing = await tx.agentDocument.findUnique({ where: key })
    if (existing) {
      await tx.agentDocumentVersion.create({
        data: {
          agentId, docType, replacedBy,
          fileName: existing.fileName, fileData: existing.fileData,
          docApprovalStatus: existing.docApprovalStatus, uploadedAt: existing.uploadedAt,
        },
      })
    }
    const docApprovalStatus = statusFor(existing?.docApprovalStatus)
    const uploadedAt = new Date()
    const stored = { fileName, fileData, uploadedAt, docApprovalStatus, docRejectionReason: null }
    await tx.agentDocument.upsert({
      where: key,
      update: { ...stored, docApprovedAt: docApprovalStatus === 'approved' ? existing?.docApprovedAt : null },
      create: { ...stored, agentId, docType },
    })
    return { previousFileName: existing?.fileName ?? null, docApprovalStatus, uploadedAt }
  })
}
