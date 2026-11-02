import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AGENT_LOOKUP_LIMIT, agentLookupRateLimiter, clientIp } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const limit = agentLookupRateLimiter.check(`login-status:${clientIp(req)}`, AGENT_LOOKUP_LIMIT.perIp, AGENT_LOOKUP_LIMIT.windowMs)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many tries. Please wait a minute and try again.' }, { status: 429 })

  const identifier = req.nextUrl.searchParams.get('identifier') ?? ''
  if (!identifier) return NextResponse.json({ locked: false, attemptsLeft: 3 })

  const id = identifier.trim().toLowerCase()
  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { agentId: id.toUpperCase() },
        { agentId: id },
        { phone: id },
      ],
    },
    select: { lockedAt: true, loginAttempts: true },
  })

  if (!agent) return NextResponse.json({ locked: false, attemptsLeft: 3 })

  const LOCKOUT_MS = 30 * 60 * 1000
  let locked = false
  let lockedMinutesRemaining = 0
  if (agent.lockedAt) {
    const remaining = LOCKOUT_MS - (Date.now() - new Date(agent.lockedAt).getTime())
    if (remaining > 0) {
      locked = true
      lockedMinutesRemaining = Math.ceil(remaining / 60000)
    }
  }

  return NextResponse.json({
    locked,
    lockedMinutesRemaining,
    attemptsLeft: locked ? 0 : Math.max(0, 3 - agent.loginAttempts),
  })
}
