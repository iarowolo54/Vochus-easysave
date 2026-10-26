import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { creditRegistrationReward } from '@/lib/reward'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, amount, method, date } = body
  const amt = parseFloat(amount)

  if (!customerId || !amt || amt <= 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active' },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'No active savings plan' }, { status: 400 })

  const rounded = money(amt)

  const priorSavings = await prisma.transaction.count({
    where: { customerId: customer.id, type: 'saving' },
  })

  const walletAfter = agent.walletBalance - rounded

  try {
    assertSufficient('Agent wallet', agent.walletBalance, rounded)
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    throw e
  }

  const txnCount = await prisma.transaction.count()
  const ref = `TXN-${String(9000 + txnCount + 1)}`

  const [txn] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ref,
        agentId: agent.id,
        customerId: customer.id,
        planId: plan.id,
        type: 'saving',
        amount: rounded,
        method: method ?? 'Cash',
        status: 'Done',
        walletAfter,
        ...(date ? { createdAt: new Date(date) } : {}),
      },
    }),
    prisma.savingsPlan.update({
      where: { id: plan.id },
      data: { balance: { increment: rounded } },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: { walletBalance: { decrement: rounded } },
    }),
  ])

  logAudit({ action: 'saving', entity: 'Transaction', entityId: txn.id, details: `₦${rounded} saving for ${customer.firstName} ${customer.lastName} (${ref}) via ${method ?? 'Cash'}`, actorId: agent.id, actorName: agent.name })

  if (priorSavings === 0) {
    creditRegistrationReward(customer).catch(() => {})
  }

  return NextResponse.json({ transaction: txn })
}
