import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { bankByCode } from '@/lib/banks'
import { cleanAccountName } from '@/lib/payout-account'
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

  const body = await req.json().catch(() => ({}))
  const bank = bankByCode(body.bankCode)
  const accountNumber = String(body.accountNumber ?? '')
  const accountName = cleanAccountName(body.accountName)
  if (!bank) return NextResponse.json({ error: 'Choose your bank from the list.' }, { status: 400 })
  if (!/^\d{10}$/.test(accountNumber)) {
    return NextResponse.json({ error: 'Account number must be 10 digits' }, { status: 400 })
  }
  if (!accountName) return NextResponse.json({ error: 'Enter the account name exactly as it is on the bank account.' }, { status: 400 })
  const { code: bankCode, name: bankName } = bank

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
    details: `${agent.name} (${agent.agentId}) set payout account → ${accountName} (as typed, not checked with the bank) · ${bankName} · ${accountNumber}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ bank: { bankCode, bankName, accountNumber, accountName } })
}
