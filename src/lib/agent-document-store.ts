import { prisma } from '@/lib/prisma'

/** How many never-reviewed files an agent's own re-uploads can leave behind per document. Each can be 5 MB in a shared SQLite database. */
export const MAX_UNREVIEWED_EARLIER_FILES = 5

/**
 * Puts a file in place for an agent's document. What it overwrites is kept as an earlier file, in the same transaction,
 * unless it's the identical file. With capUnreviewed (an agent's own upload) only that agent's never-reviewed files count
 * towards the limit and only those can be dropped, so re-uploading can't remove anything staff approved, rejected or replaced.
 */
export async function saveAgentDocument(input: {
  agentId: string
  docType: string
  fileName: string
  fileData: string
  replacedBy: string
  capUnreviewed?: boolean
  statusFor: (previous: string | undefined) => string
}) {
  const { agentId, docType, fileName, fileData, replacedBy, capUnreviewed = false, statusFor } = input
  const key = { agentId_docType: { agentId, docType } }
  return prisma.$transaction(async tx => {
    const existing = await tx.agentDocument.findUnique({ where: key })
    let droppedFiles: string[] = []
    if (existing && existing.fileData !== fileData) {
      await tx.agentDocumentVersion.create({
        data: {
          agentId, docType, replacedBy,
          fileName: existing.fileName, fileData: existing.fileData,
          docApprovalStatus: existing.docApprovalStatus, uploadedAt: existing.uploadedAt,
        },
      })
      if (capUnreviewed) {
        const beyondLimit = await tx.agentDocumentVersion.findMany({
          where: { agentId, docType, docApprovalStatus: 'pending', replacedBy },
          orderBy: { replacedAt: 'desc' },
          skip: MAX_UNREVIEWED_EARLIER_FILES,
          select: { id: true, fileName: true },
        })
        if (beyondLimit.length) {
          await tx.agentDocumentVersion.deleteMany({ where: { id: { in: beyondLimit.map(v => v.id) } } })
          droppedFiles = beyondLimit.map(v => v.fileName)
        }
      }
    }
    const docApprovalStatus = statusFor(existing?.docApprovalStatus)
    const uploadedAt = new Date()
    const stored = { fileName, fileData, uploadedAt, docApprovalStatus, docRejectionReason: null }
    await tx.agentDocument.upsert({
      where: key,
      update: { ...stored, docApprovedAt: docApprovalStatus === 'approved' ? existing?.docApprovedAt : null },
      create: { ...stored, agentId, docType },
    })
    return { previousFileName: existing?.fileName ?? null, docApprovalStatus, uploadedAt, droppedFiles }
  })
}
