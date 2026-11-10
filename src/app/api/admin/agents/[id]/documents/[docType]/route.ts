import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { saveAgentDocument } from '@/lib/agent-document-store'
import { serveStoredFile, storedFileHeaders, validateUpload } from '@/lib/upload-safety'
import { agentDocLabel, canStoreAgentDoc, parseRequiredDocs, statusAfterStaffUpload } from '@/lib/agent-documents'

type Ctx = { params: Promise<{ id: string; docType: string }> }

/** Opens one document. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response

  const { id, docType } = await params
  const doc = await prisma.agentDocument.findUnique({
    where: { agentId_docType: { agentId: id, docType } },
    select: { fileName: true, fileData: true },
  })
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const file = serveStoredFile(doc.fileData, doc.fileName)
  return new NextResponse(new Uint8Array(file.body), { headers: storedFileHeaders(file, doc.fileName) })
}

/** Staff replace a document, or add one the agent never uploaded. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response

  const { id, docType } = await params
  const body: unknown = await req.json().catch(() => null)
  const { fileName, fileData } = (body && typeof body === 'object' ? body : {}) as { fileName?: unknown; fileData?: unknown }

  const upload = validateUpload(fileName, fileData)
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true, agentId: true, name: true, requiredDocs: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const onFile = await prisma.agentDocument.findUnique({ where: { agentId_docType: { agentId: agent.id, docType } }, select: { id: true } })
  if (!canStoreAgentDoc(docType, parseRequiredDocs(agent.requiredDocs), !!onFile)) {
    return NextResponse.json({ error: 'That document type isn’t used for this agent' }, { status: 400 })
  }

  const saved = await saveAgentDocument({
    agentId: agent.id, docType, fileName: upload.fileName, fileData: upload.fileData,
    replacedBy: guard.actor.name, statusFor: statusAfterStaffUpload,
  })
  const { previousFileName, docApprovalStatus, uploadedAt } = saved

  logAudit({
    action: previousFileName ? 'agent_document_replaced' : 'agent_document_added',
    entity: 'AgentDocument',
    entityId: agent.id,
    details: previousFileName
      ? `${agentDocLabel(docType)} replaced for ${agent.name} (${agent.agentId}): ${previousFileName} became ${upload.fileName}`
      : `${agentDocLabel(docType)} added for ${agent.name} (${agent.agentId}): ${upload.fileName}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({
    document: { docType, fileName: upload.fileName, uploadedAt, docApprovalStatus, docRejectionReason: null },
  })
}
