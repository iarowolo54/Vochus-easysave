import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { serveStoredFile, storedFileHeaders } from '@/lib/upload-safety'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ docType: string }> }
) {
  const url = new URL(req.url)
  const agentIdParam = url.searchParams.get('agentId')

  // Accept either an agent's own session OR a super-admin session.
  const agentSession = await getServerSession(authOptions)
  const adminSession = agentIdParam
    ? await getServerSession(adminAuthOptions)
    : null

  // The role, not just a session: the admin and agent configs share a secret, so an agent's token decodes in the admin cookie.
  const isAdmin = (adminSession?.user as { role?: string } | undefined)?.role === 'superadmin'

  if (!agentSession?.user && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { docType } = await params

  // Admins pass ?agentId=; agents view their own docs (agentIdParam optional).
  const whereAgent = isAdmin && agentIdParam
    ? { id: agentIdParam }
    : agentIdParam
      ? { id: agentIdParam }
      : { agentId: (agentSession?.user as any).agentId }

  const agent = await prisma.agent.findFirst({ where: whereAgent })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // An agent may only view their own documents.
  if (!isAdmin && agent.agentId !== (agentSession?.user as any).agentId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const doc = await prisma.agentDocument.findFirst({
    where: { agentId: agent.id, docType },
  })
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const file = serveStoredFile(doc.fileData, doc.fileName)
  return new NextResponse(new Uint8Array(file.body), { headers: storedFileHeaders(file, doc.fileName) })
}
