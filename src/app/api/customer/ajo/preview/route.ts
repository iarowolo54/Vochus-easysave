import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { AJO_CODE_NOT_FOUND, ajoCodeProblem, ajoFeeOn, isJoinCode, potOf, roundLabel, type AjoCadence } from '@/lib/ajo'
import { getAjoFee } from '@/lib/ajo-fee'
import { AJO_CODE_LIMIT, ajoCodeRateLimiter } from '@/lib/rate-limit'
import { displayName } from '@/lib/format'

/** Look a group up by its code before joining. Only the customer's own agent's groups, and only while forming. */
export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = ajoCodeRateLimiter.check(`ajo:${session.id}`, AJO_CODE_LIMIT.perCustomer, AJO_CODE_LIMIT.windowMs)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many tries. Wait a few minutes, then try again.' }, { status: 429 })

  const code = req.nextUrl.searchParams.get('code') ?? ''
  if (!isJoinCode(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { agentId: true } })
  if (!customer) return NextResponse.json({ error: AJO_CODE_NOT_FOUND }, { status: 404 })
  const g = await prisma.ajoGroup.findUnique({
    where: { code },
    select: { id: true, name: true, agentId: true, status: true, cadence: true, size: true, contribution: true, startDate: true, agent: { select: { name: true } }, members: { select: { customerId: true } } },
  })
  const problem = ajoCodeProblem(g, customer.agentId)
  if (problem || !g) return NextResponse.json({ error: problem ?? AJO_CODE_NOT_FOUND }, { status: 404 })
  const cadence = g.cadence as AjoCadence
  const rate = await getAjoFee(prisma)
  return NextResponse.json({
    group: {
      id: g.id, name: g.name, cadence, size: g.size, contribution: g.contribution, pot: potOf(g), feePct: rate.feePct, platformFee: ajoFeeOn(potOf(g), rate).fee, startDate: g.startDate,
      firstRound: roundLabel(g.startDate, cadence, 1), lastRound: roundLabel(g.startDate, cadence, g.size),
      agentName: displayName(g.agent.name), memberCount: g.members.length,
      full: g.members.length >= g.size, alreadyIn: g.members.some(m => m.customerId === session.id),
    },
  })
}
