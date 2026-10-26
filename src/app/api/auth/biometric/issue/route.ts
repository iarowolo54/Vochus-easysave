import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomBytes, createHash } from 'crypto'

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { deviceId } = await req.json()
  if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Revoke any prior tokens for this device
  await prisma.biometricToken.updateMany({
    where: { agentId: agent.id, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  const token = randomBytes(32).toString('hex')
  await prisma.biometricToken.create({
    data: { agentId: agent.id, deviceId, tokenHash: sha256(token) },
  })

  return NextResponse.json({ token, identifier: agent.agentId })
}
