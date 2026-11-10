import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { serveStoredFile, storedFileHeaders } from '@/lib/upload-safety'

/** Opens a file that has since been replaced. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; docType: string; versionId: string }> }) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response

  const { id, docType, versionId } = await params
  const version = await prisma.agentDocumentVersion.findFirst({
    where: { id: versionId, agentId: id, docType },
    select: { fileName: true, fileData: true },
  })
  if (!version) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const file = serveStoredFile(version.fileData, version.fileName)
  return new NextResponse(new Uint8Array(file.body), { headers: storedFileHeaders(file, version.fileName) })
}
