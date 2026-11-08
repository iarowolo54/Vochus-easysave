import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { parseNewGroup, potOf } from '@/lib/ajo'
import { isUniqueViolation, newJoinCode, sessionAgent } from '@/lib/ajo-server'

/** The agent's own groups, newest first. */
export async function GET() {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const groups = await prisma.ajoGroup.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, code: true, cadence: true, size: true, contribution: true, startDate: true, status: true, _count: { select: { members: true, payouts: true } } },
  })
  return NextResponse.json({
    groups: groups.map(({ _count, ...g }) => ({ ...g, pot: potOf(g), memberCount: _count.members, paidOutRounds: _count.payouts })),
  })
}

/** Create a group. The server picks the join code. */
export async function POST(req: NextRequest) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseNewGroup(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const g = await prisma.ajoGroup.create({ data: { ...parsed.value, code: newJoinCode(), agentId: agent.id } })
      logAudit({
        action: 'ajo_group_created', entity: 'AjoGroup', entityId: g.id,
        details: `Agent ${agent.name} (${agent.agentId}) created Ajo group "${g.name}": ${g.size} members, ₦${g.contribution} ${g.cadence}, starts ${g.startDate.toISOString().slice(0, 10)}`,
        actorType: 'agent', actorId: agent.id, actorName: agent.name,
      })
      return NextResponse.json({ group: { id: g.id, code: g.code } })
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  return NextResponse.json({ error: 'Couldn’t make a join code just now. Try again.' }, { status: 503 })
}
