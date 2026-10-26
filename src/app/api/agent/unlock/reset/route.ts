import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
  try {
    const { identifier, token, newPin } = await req.json()

    if (!identifier || !token || !newPin) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    if (newPin.length < 4) {
      return NextResponse.json({ error: 'PIN must be at least 4 characters' }, { status: 400 })
    }

    const id = identifier.trim().toLowerCase()
    const agent = await prisma.agent.findFirst({
      where: {
        OR: [
          { agentId: id.toUpperCase() },
          { agentId: id },
          { phone: id },
        ],
      },
    })

    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    if (!agent.unlockToken || !agent.unlockTokenExpiry) {
      return NextResponse.json({ error: 'No unlock request found. Please request a new code.' }, { status: 400 })
    }

    if (new Date() > agent.unlockTokenExpiry) {
      return NextResponse.json({ error: 'Unlock code has expired. Please request a new one.' }, { status: 400 })
    }

    if (agent.unlockToken !== String(token).trim()) {
      return NextResponse.json({ error: 'Invalid unlock code' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(newPin, 10)

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        password: hashed,
        loginAttempts: 0,
        lockedAt: null,
        unlockToken: null,
        unlockTokenExpiry: null,
      },
    })

    logAudit({
      action: 'agent_unlock_reset',
      entity: 'Agent',
      entityId: agent.id,
      details: `Agent ${agent.name} (${agent.agentId}) reset PIN via unlock flow`,
      actorType: 'agent',
      actorId: agent.id,
      actorName: agent.name,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}
