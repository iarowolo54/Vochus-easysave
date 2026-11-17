import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAgent } from '@/app/api/customers/requests/_agent'

/** How many of the agent's requests (cash savers and upgrades together) are waiting on the office, and how many came back to fix. */
export async function GET() {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const agentId = guard.agent.id
  const [cashWaiting, cashToFix, upgWaiting, upgToFix] = await Promise.all([
    prisma.customerRequest.count({ where: { agentId, status: 'Pending' } }),
    prisma.customerRequest.count({ where: { agentId, status: 'Denied' } }),
    prisma.agentUpgradeRequest.count({ where: { agentId, status: 'Pending' } }),
    prisma.agentUpgradeRequest.count({ where: { agentId, status: 'Denied' } }),
  ])
  return NextResponse.json({ waiting: cashWaiting + upgWaiting, toFix: cashToFix + upgToFix })
}
