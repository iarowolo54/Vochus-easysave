import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { loadGroup, sessionAgent } from '@/lib/ajo-server'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await loadGroup(prisma, { id, agentId: agent.id })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ group }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Cancel a group that hasn't started. Once it is running, money has moved and it can't be cancelled here. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const done = await prisma.ajoGroup.updateMany({ where: { id, agentId: agent.id, status: 'Forming' }, data: { status: 'Cancelled' } })
  if (done.count === 0) {
    const exists = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true } })
    return exists
      ? NextResponse.json({ error: 'This group has started, so it can’t be cancelled.' }, { status: 409 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  logAudit({ action: 'ajo_group_cancelled', entity: 'AjoGroup', entityId: id, details: `Agent ${agent.name} (${agent.agentId}) cancelled an Ajo group before it started`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
