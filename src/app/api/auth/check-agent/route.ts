import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const LOCKOUT_MS = 30 * 60 * 1000

export async function POST(req: NextRequest) {
  const { identifier, deviceId, app } = await req.json()

  if (!identifier) {
    return NextResponse.json({ exists: false, status: null })
  }

  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { agentId: identifier.toUpperCase() },
        { agentId: identifier },
        { phone: identifier },
      ],
    },
    select: { status: true, boundDeviceId: true, lockedAt: true, email: true, emailVerified: true },
  })

  // Device binding only applies to the mobile app. Browser logins bypass it.
  const deviceMismatch = !!(
    app === 'agent' &&
    agent?.boundDeviceId &&
    agent.boundDeviceId !== deviceId
  )

  let locked = false
  let lockedMinutesRemaining = 0
  if (agent?.lockedAt) {
    const remaining = LOCKOUT_MS - (Date.now() - new Date(agent.lockedAt).getTime())
    if (remaining > 0) {
      locked = true
      lockedMinutesRemaining = Math.ceil(remaining / 60000)
    }
  }

  const unverifiedEmail = !!(agent?.email && !agent.emailVerified)

  return NextResponse.json({
    exists: !!agent,
    status: agent?.status ?? null,
    deviceMismatch,
    locked,
    lockedMinutesRemaining,
    unverifiedEmail,
  })
}
