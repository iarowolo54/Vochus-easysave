import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { isJoinCode, potOf, roundLabel, type AjoCadence } from '@/lib/ajo'
import { AJO_CODE_LIMIT, ajoCodeRateLimiter } from '@/lib/rate-limit'
import { displayName } from '@/lib/format'

const NOT_FOUND = 'No group with that code. Check it with your agent.'

/** Look a group up by its code before joining. Only the customer's own agent's groups, and only while forming. */
export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = ajoCodeRateLimiter.check(`ajo:${session.id}`, AJO_CODE_LIMIT.perCustomer, AJO_CODE_LIMIT.windowMs)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many tries. Wait a few minutes, then try again.' }, { status: 429 })

  const code = req.nextUrl.searchParams.get('code') ?? ''
  if (!isJoinCode(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { agentId: true } })
  const g = customer && await prisma.ajoGroup.findFirst({
    where: { code, agentId: customer.agentId, status: 'Forming' },
    select: { id: true, name: true, cadence: true, size: true, contribution: true, startDate: true, agent: { select: { name: true } }, members: { select: { customerId: true } } },
  })
  if (!g) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  const cadence = g.cadence as AjoCadence
  return NextResponse.json({
    group: {
      id: g.id, name: g.name, cadence, size: g.size, contribution: g.contribution, pot: potOf(g), startDate: g.startDate,
      firstRound: roundLabel(g.startDate, cadence, 1), lastRound: roundLabel(g.startDate, cadence, g.size),
      agentName: displayName(g.agent.name), memberCount: g.members.length,
      yourTurn: g.members.length < g.size ? roundLabel(g.startDate, cadence, g.members.length + 1) : null,
      full: g.members.length >= g.size, alreadyIn: g.members.some(m => m.customerId === session.id),
    },
  })
}
