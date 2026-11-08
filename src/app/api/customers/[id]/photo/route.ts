import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { validatePhoto } from '@/lib/photo'

async function sessionAgent() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true, name: true, agentId: true, status: true } })
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

// The agent takes a new photo of one of their own customers (a missing photo, or one where the face isn't clear).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (agent.status !== 'Active') return NextResponse.json({ error: 'Your account is not active' }, { status: 403 })

  const { id } = await params
  const customer = await prisma.customer.findFirst({
    where: { id, agentId: agent.id },
    select: { id: true, firstName: true, lastName: true, customerId: true, photoUrl: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const photoUrl = body && typeof body === 'object' ? (body as { photoUrl?: unknown }).photoUrl : undefined
  if (typeof photoUrl !== 'string' || !photoUrl) return NextResponse.json({ error: 'Take a photo first.' }, { status: 400 })
  const check = validatePhoto(photoUrl)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  await prisma.customer.update({ where: { id: customer.id }, data: { photoUrl } })

  logAudit({
    action: 'customer_photo_retaken',
    entity: 'Customer',
    entityId: customer.id,
    details: `Agent ${agent.name} (${agent.agentId}) ${customer.photoUrl ? 'replaced' : 'added'} the photo for ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ ok: true, photoUrl: `/api/customers/${customer.id}/photo?v=${Date.now()}` })
}
