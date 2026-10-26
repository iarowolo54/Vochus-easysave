import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveAccount } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agent = await prisma.agent.findFirst({
    where: { agentId: session.user.agentId },
    select: { bankCode: true, bankName: true, accountNumber: true, accountName: true },
  })
  return NextResponse.json({ bank: agent ?? null })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { bankCode, bankName, accountNumber } = await req.json()
  if (!bankCode || !bankName || !accountNumber) {
    return NextResponse.json({ error: 'bankCode, bankName and accountNumber required' }, { status: 400 })
  }
  if (!/^\d{10}$/.test(String(accountNumber))) {
    return NextResponse.json({ error: 'Account number must be 10 digits' }, { status: 400 })
  }

  let accountName: string | null = null
  try {
    const result = await resolveAccount(accountNumber, bankCode)
    accountName = result.accountName
  } catch {
    accountName = null
  }

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  await prisma.agent.update({
    where: { id: agent.id },
    data: { bankCode, bankName, accountNumber, accountName },
  })

  logAudit({
    action: 'agent_bank_update',
    entity: 'Agent',
    entityId: agent.id,
    details: `${agent.name} (${agent.agentId}) set payout account → ${accountName ?? 'UNVERIFIED'} · ${bankName} · ${accountNumber}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ bank: { bankCode, bankName, accountNumber, accountName } })
}
