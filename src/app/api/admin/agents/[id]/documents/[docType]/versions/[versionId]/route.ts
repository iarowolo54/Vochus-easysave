import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { agentDocLabel } from '@/lib/agent-documents'
import { serveStoredFile, storedFileHeaders } from '@/lib/upload-safety'

/** Opens a file that has since been replaced. Same rule as the current file: approvers only, and every open is logged. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; docType: string; versionId: string }> }) {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response

  const { id, docType, versionId } = await params
  const version = await prisma.agentDocumentVersion.findFirst({
    where: { id: versionId, agentId: id, docType },
    select: { fileName: true, fileData: true },
  })
  if (!version) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  logAudit({
    action: 'agent_document_viewed',
    entity: 'AgentDocument',
    entityId: id,
    details: `Opened an earlier ${agentDocLabel(docType)} for agent ${id}: ${version.fileName}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  const file = serveStoredFile(version.fileData, version.fileName)
  return new NextResponse(new Uint8Array(file.body), { headers: storedFileHeaders(file, version.fileName) })
}
