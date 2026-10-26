import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { pin, currentPassword } = await req.json()

  if (!pin || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4–6 digits' }, { status: 400 })
  }

  if (!currentPassword) {
    return NextResponse.json({ error: 'Password is required to set PIN' }, { status: 400 })
  }

  const valid = await bcrypt.compare(currentPassword, agent.password)
  if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 400 })

  const hashed = await bcrypt.hash(pin, 10)
  await prisma.agent.update({ where: { id: agent.id }, data: { transactionPin: hashed } })

  logAudit({
    action: 'agent_transaction_pin_set',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) set their transaction PIN`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ ok: true })
}
