// The agent's on/off switch for sign-in and payment emails. Only works on a verified email.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const on = typeof body === 'object' && body !== null ? (body as { on?: unknown }).on : undefined
  if (typeof on !== 'boolean') return NextResponse.json({ error: 'Choose on or off' }, { status: 400 })

  // The owner is in the where, so this can only change the signed-in agent's own row.
  const res = await prisma.agent.updateMany({ where: { agentId: session.user.agentId, email: { not: null }, emailVerified: true }, data: { emailAlertsOn: on } })
  if (res.count !== 1) return NextResponse.json({ error: 'There is no confirmed email on your account.' }, { status: 409 })
  return NextResponse.json({ emailAlertsOn: on })
}
