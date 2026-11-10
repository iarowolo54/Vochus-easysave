import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateUpload } from '@/lib/upload-safety'
import { saveAgentDocument } from '@/lib/agent-document-store'
import { logAudit } from '@/lib/audit'

const DOC_META: Record<string, { icon: string; label: string; sub: string; required: boolean }> = {
  id:    { icon: '🪪', label: 'Government-Issued ID',  sub: "NIN slip, Passport, Driver's Licence or Voter's Card", required: true },
  addr:  { icon: '🏠', label: 'Proof of Address',       sub: 'Utility bill or bank statement (not older than 3 months)', required: true },
  guar:  { icon: '✍️', label: 'Signed Guarantor Form',  sub: 'Completed and signed Vochus Easy Save guarantor form', required: true },
  agree: { icon: '📋', label: 'Signed Agent Agreement', sub: 'Signed Vochus Easy Save Agent Terms & Conditions', required: true },
  bank:  { icon: '💳', label: 'Bank Statement',          sub: 'Optional — for commission payout purposes', required: false },
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agentId = (session.user as any).agentId
  const agent = await prisma.agent.findFirst({
    where: { agentId },
    include: { documents: { select: { docType: true, fileName: true, docApprovalStatus: true, docRejectionReason: true } } },
  })

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const requiredDocs = JSON.parse(agent.requiredDocs || '[]') as string[]
  const docMap = Object.fromEntries(agent.documents.map(d => [d.docType, d]))

  const docs = requiredDocs.map(id => ({
    id,
    ...(DOC_META[id] ?? { icon: '📄', label: id, sub: '', required: true }),
    uploaded: !!docMap[id],
    fileName: docMap[id]?.fileName,
    approvalStatus: docMap[id]?.docApprovalStatus ?? 'not_uploaded',
    rejectionReason: docMap[id]?.docRejectionReason,
  }))

  return NextResponse.json({ docs })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agentId = (session.user as any).agentId
  const { docType, fileName, fileData } = await req.json()

  if (!docType || !fileName || !fileData) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const upload = validateUpload(fileName, fileData)
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 })

  const agent = await prisma.agent.findFirst({ where: { agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const requiredDocs = JSON.parse(agent.requiredDocs || '[]') as string[]
  if (!requiredDocs.includes(docType)) {
    return NextResponse.json({ error: 'Document not required for this agent' }, { status: 400 })
  }

  const saved = await saveAgentDocument({
    agentId: agent.id, docType, fileName: upload.fileName, fileData: upload.fileData,
    replacedBy: `Agent ${agent.agentId}`, capUnreviewed: true, statusFor: () => 'pending',
  })

  logAudit({
    action: 'agent_document_uploaded',
    entity: 'AgentDocument',
    entityId: agent.id,
    details: `${agent.agentId} uploaded ${docType}: ${upload.fileName}`
      + (saved.previousFileName ? `, replacing ${saved.previousFileName}` : '')
      + (saved.droppedFiles.length ? `. Oldest unreviewed files dropped: ${saved.droppedFiles.join(', ')}` : ''),
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ ok: true })
}
