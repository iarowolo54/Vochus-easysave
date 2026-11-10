import { prisma } from '@/lib/prisma'

/** How many never-reviewed files an agent's own re-uploads can leave behind per document. Each can be 5 MB in a shared SQLite database. */
export const MAX_UNREVIEWED_EARLIER_FILES = 5

/**
 * Puts a file in place for an agent's document. What it overwrites is kept as an earlier file, in the same transaction.
 * The identical file changes nothing at all, so re-sending a copy can't relabel who supplied it or reset its review. With capUnreviewed (an agent's own upload) the limit covers only files that same agent both
 * supplied and replaced and nobody reviewed, so re-uploading can't remove anything staff supplied, approved, rejected or replaced.
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
    if (existing?.fileData === fileData) {
      return { unchanged: true, fileName: existing.fileName, previousFileName: existing.fileName, docApprovalStatus: existing.docApprovalStatus, uploadedAt: existing.uploadedAt, docRejectionReason: existing.docRejectionReason, droppedFiles: [] as string[] }
    }
    let droppedFiles: string[] = []
    if (existing) {
      await tx.agentDocumentVersion.create({
        data: {
          agentId, docType, replacedBy,
          fileName: existing.fileName, fileData: existing.fileData,
          docApprovalStatus: existing.docApprovalStatus, uploadedAt: existing.uploadedAt, uploadedBy: existing.uploadedBy,
        },
      })
      if (capUnreviewed) {
        const beyondLimit = await tx.agentDocumentVersion.findMany({
          where: { agentId, docType, docApprovalStatus: 'pending', replacedBy, uploadedBy: replacedBy },
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
    const stored = { fileName, fileData, uploadedAt, docApprovalStatus, docRejectionReason: null, uploadedBy: replacedBy }
    await tx.agentDocument.upsert({
      where: key,
      update: { ...stored, docApprovedAt: docApprovalStatus === 'approved' ? existing?.docApprovedAt : null },
      create: { ...stored, agentId, docType },
    })
    return { unchanged: false, fileName, previousFileName: existing?.fileName ?? null, docApprovalStatus, uploadedAt, docRejectionReason: null, droppedFiles }
  })
}
