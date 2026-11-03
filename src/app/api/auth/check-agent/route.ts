import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { agentLoginIpKey } from '@/lib/auth'
import { checkLoginThrottle } from '@/lib/login-attempt'
import { AGENT_LOOKUP_LIMIT, agentLookupRateLimiter, clientIp } from '@/lib/rate-limit'

const LOCKOUT_MS = 30 * 60 * 1000

export async function POST(req: NextRequest) {
  const limit = agentLookupRateLimiter.check(`check-agent:${clientIp(req)}`, AGENT_LOOKUP_LIMIT.perIp, AGENT_LOOKUP_LIMIT.windowMs)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many tries. Please wait a minute and try again.' }, { status: 429 })

  const { identifier, deviceId, app } = await req.json()

  if (!identifier || typeof identifier !== 'string') {
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

  // If this address is blocked, that's why the sign-in failed, whatever the account's state.
  const ip = agentLoginIpKey(req.headers.get('x-forwarded-for'))
  const throttle = ip ? await checkLoginThrottle({ ip }).catch(() => null) : null

  return NextResponse.json({
    throttledSeconds: throttle?.retryAfterSeconds ?? 0,
    exists: !!agent,
    status: agent?.status ?? null,
    deviceMismatch,
    locked,
    lockedMinutesRemaining,
    unverifiedEmail,
  })
}
