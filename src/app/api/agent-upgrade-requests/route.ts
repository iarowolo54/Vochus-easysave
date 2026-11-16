import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAgent } from '@/app/api/customers/requests/_agent'
import { documentsState, NEW_AGENT_REQUIRED_DOCS } from '@/lib/agent-upgrade'
import { parseRequiredDocs } from '@/lib/agent-documents'

/** The signed-in agent's own agent requests, newest first. For approved ones, how far the new agent is with their documents. */
export async function GET() {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const requests = await prisma.agentUpgradeRequest.findMany({
    where: { agentId: guard.agent.id },
    orderBy: { submittedAt: 'desc' },
    take: 100,
    select: {
      id: true, status: true, submittedAt: true, decidedAt: true, denyReason: true, denyFix: true, createdAgentId: true,
      customer: { select: { id: true, firstName: true, lastName: true, customerId: true } },
    },
  })
  const created = await prisma.agent.findMany({
    where: { id: { in: requests.flatMap(r => (r.createdAgentId ? [r.createdAgentId] : [])) } },
    select: { id: true, agentId: true, requiredDocs: true, documents: { select: { docType: true, docApprovalStatus: true } } },
  })
  const byId = new Map(created.map(a => [a.id, a]))
  return NextResponse.json({
    requests: requests.map(({ createdAgentId, ...r }) => {
      const a = createdAgentId ? byId.get(createdAgentId) : undefined
      const required = a ? parseRequiredDocs(a.requiredDocs) : [...NEW_AGENT_REQUIRED_DOCS]
      return { ...r, newAgentCode: a?.agentId ?? null, documents: a ? documentsState(required, a.documents) : null }
    }),
  })
}
