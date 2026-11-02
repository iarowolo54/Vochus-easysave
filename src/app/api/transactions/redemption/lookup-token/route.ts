import { NextRequest, NextResponse } from 'next/server'
import { confirmRequestWithCode } from '@/lib/redemption-balance'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hashRedemptionToken } from '@/lib/redemption-token'
import { logAudit } from '@/lib/audit'
import { CODE_LOOKUPS_PER_HOUR, spendCodeLookup } from '@/lib/redemption-attempts'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ valid: false, error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ valid: false, error: 'Agent not found' }, { status: 401 })

  // This route resolves a redemption from the 6-digit code alone (no ref), and a correct code confirms the
  // request, so guessing has to be impractical. A wrong guess matches no record: cap it per agent instead.
  const budget = await spendCodeLookup(prisma, agent.id)
  if (!budget.allowed) {
    if (budget.firstRefusal) {
      await logAudit({
        action: 'redemption_code_lookup_limit',
        entity: 'Agent',
        entityId: agent.id,
        details: `${agent.name} (${agent.agentId}) reached ${CODE_LOOKUPS_PER_HOUR} redemption code lookups in an hour`,
        actorId: agent.id,
        actorName: agent.name,
      })
    }
    return NextResponse.json({ valid: false, error: 'Too many code lookups. Please try again in an hour.' }, { status: 429 })
  }

  const { token } = await req.json()
  if (!token) return NextResponse.json({ valid: false, error: 'Token is required' }, { status: 400 })

  const record = await prisma.earlyRedemption.findFirst({
    where: { token: hashRedemptionToken(token) },
    include: {
      savingsPlan: {
        include: { customer: { select: { agentId: true, firstName: true, lastName: true } } },
      },
    },
  })

  // Single non-committal response for both "no such code" and "belongs to another
  // agent's customer", so a guessed code can't be used to probe existence across
  // tenants.
  if (!record || record.savingsPlan.customer.agentId !== agent.id) {
    return NextResponse.json({ valid: false, error: 'No matching pending redemption for your customers' })
  }
  if (record.status === 'Rejected') return NextResponse.json({ valid: false, error: 'REJECTED', planId: record.savingsPlanId, customerName: `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}` })
  if (record.status !== 'Pending') return NextResponse.json({ valid: false, error: `This redemption has already been ${record.status.toLowerCase()}` })
  if (!record.tokenExpiry || record.tokenExpiry < new Date()) return NextResponse.json({ valid: false, error: 'Token has expired' })
  if (!(await confirmRequestWithCode(prisma, record.id))) return NextResponse.json({ valid: false, error: 'This redemption is no longer pending' })

  return NextResponse.json({
    valid: true,
    record: {
      id: record.id,
      ref: record.ref,
      netPayout: record.netPayout,
      customerName: `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`,
      payoutMethod: record.payoutMethod,
      balance: record.balance,
      penalty: record.penalty,
    },
  })
}
