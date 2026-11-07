import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { countNew, loadFeed } from '@/lib/notification-feed'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

async function currentAgent() {
  const session = await getServerSession(authOptions)
  const code = session?.user?.agentId
  if (!code) return null
  return prisma.agent.findFirst({ where: { agentId: code }, select: { id: true, notificationsSeenAt: true } })
}

/** ?count=1 → { count } for the bell; otherwise { items, newCount }. Only this agent's own notifications. */
export async function GET(req: NextRequest) {
  const agent = await currentAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.nextUrl.searchParams.get('count') === '1') {
    return NextResponse.json({ count: await countNew(prisma, 'agent', agent.id, agent.notificationsSeenAt) }, NO_STORE)
  }
  return NextResponse.json(await loadFeed(prisma, 'agent', agent.id, agent.notificationsSeenAt), NO_STORE)
}

/** The list was opened: everything up to now counts as seen, so the bell clears. */
export async function POST() {
  const agent = await currentAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.agent.update({ where: { id: agent.id }, data: { notificationsSeenAt: new Date() } })
  return NextResponse.json({ ok: true })
}
