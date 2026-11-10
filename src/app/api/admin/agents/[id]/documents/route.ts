import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parseRequiredDocs } from '@/lib/agent-documents'

/** The agent's documents on file. The file contents are large and are only fetched one at a time, to open them. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response

  const { id } = await params
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      requiredDocs: true,
      documents: { select: { docType: true, fileName: true, uploadedAt: true, docApprovalStatus: true, docRejectionReason: true } },
      documentVersions: { select: { id: true, docType: true, fileName: true, replacedAt: true, replacedBy: true }, orderBy: { replacedAt: 'desc' } },
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const canManage = (await requirePermission('agents', 'manage')).ok
  return NextResponse.json({ required: parseRequiredDocs(agent.requiredDocs), documents: agent.documents, versions: agent.documentVersions, canManage })
}
