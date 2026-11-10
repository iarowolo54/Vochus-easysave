import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serveStoredFile, storedFileHeaders } from '@/lib/upload-safety'

/** An agent opens their own document. Staff use /api/admin/agents/[id]/documents/[docType], which checks permission and logs the open. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ docType: string }> }
) {
  const session = await getServerSession(authOptions)
  const agentId = (session?.user as { agentId?: string } | undefined)?.agentId
  if (!agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { docType } = await params

  const agent = await prisma.agent.findFirst({ where: { agentId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const asked = new URL(req.url).searchParams.get('agentId')
  if (asked && asked !== agent.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const doc = await prisma.agentDocument.findFirst({
    where: { agentId: agent.id, docType },
  })
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const file = serveStoredFile(doc.fileData, doc.fileName)
  return new NextResponse(new Uint8Array(file.body), { headers: storedFileHeaders(file, doc.fileName) })
}
