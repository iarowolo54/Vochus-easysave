import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// The agent turned fingerprint sign-in off on this phone: its token stops working on the server too, not just on the phone.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
  if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  await prisma.biometricToken.updateMany({
    where: { agentId: agent.id, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
