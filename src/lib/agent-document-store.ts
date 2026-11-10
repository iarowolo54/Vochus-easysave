import { prisma } from '@/lib/prisma'

/** How many earlier files are kept per document. Agents can re-upload freely, and each file can be 5 MB in a shared SQLite database. */
export const MAX_EARLIER_FILES = 5

/**
 * Puts a file in place for an agent's document. What it overwrites is kept as an earlier file, in the same transaction,
 * unless it's the identical file. Beyond the limit the oldest earlier file is dropped.
 */
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
    if (existing && existing.fileData !== fileData) {
      await tx.agentDocumentVersion.create({
        data: {
          agentId, docType, replacedBy,
          fileName: existing.fileName, fileData: existing.fileData,
          docApprovalStatus: existing.docApprovalStatus, uploadedAt: existing.uploadedAt,
        },
      })
      const beyondLimit = await tx.agentDocumentVersion.findMany({
        where: { agentId, docType },
        orderBy: { replacedAt: 'desc' },
        skip: MAX_EARLIER_FILES,
        select: { id: true },
      })
      if (beyondLimit.length) await tx.agentDocumentVersion.deleteMany({ where: { id: { in: beyondLimit.map(v => v.id) } } })
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
