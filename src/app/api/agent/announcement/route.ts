import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { dismissAnnouncement, nextAnnouncement } from '@/lib/announcements'

async function agentId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  // Fail closed: an undefined filter would match the first agent in the table.
  const agentId = session?.user?.agentId
  if (typeof agentId !== 'string' || !agentId) return null
  const agent = await prisma.agent.findUnique({ where: { agentId }, select: { id: true } })
  return agent?.id ?? null
}

/** The pop-up message to show this agent now, if any. */
export async function GET() {
  const id = await agentId()
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ announcement: await nextAnnouncement(prisma, 'agent', id) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** The agent tapped OK: don't show it to them again. */
export async function POST(req: NextRequest) {
  const id = await agentId()
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const announcementId = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined
  if (typeof announcementId !== 'string' || !announcementId) return NextResponse.json({ error: 'Missing message' }, { status: 400 })
  if (!(await dismissAnnouncement(prisma, 'agent', id, announcementId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
