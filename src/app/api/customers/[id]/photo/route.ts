import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { submitAgentPhoto } from '@/lib/customer-photo-request'

async function sessionAgent() {
  const session = await getServerSession(authOptions)
  // Fail closed: an undefined filter would match the first agent in the table.
  const agentId = session?.user?.agentId
  if (typeof agentId !== 'string' || !agentId) return null
  return prisma.agent.findUnique({ where: { agentId }, select: { id: true, name: true, agentId: true, status: true } })
}

// Serves one of the agent's own customers' photos as an image, so customer lists carry a link
// instead of every base64 photo inside the JSON.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await sessionAgent()
  if (!agent) return new NextResponse(null, { status: 401 })

  const { id } = await params
  const row = await prisma.customer.findFirst({ where: { id, agentId: agent.id }, select: { photoUrl: true } })
  const m = row?.photoUrl?.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m) return new NextResponse(null, { status: 404 })

  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  })
}

// The agent takes a photo of one of their own customers (a missing photo, or one where the face isn't clear). It goes
// to the super admin to check; only an approved photo reaches the customer (src/lib/customer-photo-request.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (agent.status !== 'Active') return NextResponse.json({ error: 'Your account is not active' }, { status: 403 })

  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const photoUrl = body && typeof body === 'object' ? (body as { photoUrl?: unknown }).photoUrl : undefined
  const r = await submitAgentPhoto(prisma, { customerDbId: id, agent, photoUrl })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, status: 'pending' })
}
