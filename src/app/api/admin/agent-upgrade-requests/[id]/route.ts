import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { documentsState, findBlockers, savingsSummary } from '@/lib/agent-upgrade'
import { agentDocLabel, parseRequiredDocs } from '@/lib/agent-documents'
import { findIdentityConflict } from '@/lib/identity'

/** Everything the office weighs: the customer, their savings history, the details sent and the agent who asked. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agent-requests', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await prisma.agentUpgradeRequest.findUnique({
    where: { id },
    select: {
      id: true, status: true, nin: true, bvn: true, state: true, lga: true, address: true, nokName: true, nokPhone: true,
      submittedAt: true, decidedAt: true, decidedBy: true, denyReason: true, denyFix: true, createdAgentId: true,
      agent: { select: { id: true, agentId: true, name: true, phone: true, location: true } },
      customer: {
        select: {
          id: true, customerId: true, firstName: true, lastName: true, phone: true, email: true, emailVerifiedAt: true, dob: true, gender: true,
          address: true, state: true, lga: true, nokName: true, nokRelation: true, nokPhone: true, photoUrl: true, status: true, type: true, createdAt: true, walletBalance: true,
        },
      },
    },
  })
  if (!r) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  const open = r.status === 'Pending'
  const [summary, blockers, conflict, newAgent] = await Promise.all([
    savingsSummary(prisma, r.customer.id),
    open ? findBlockers(prisma, r.customer.id) : Promise.resolve([]),
    open ? findIdentityConflict(prisma, { phone: r.customer.phone, email: r.customer.email }, { excludeCustomerId: r.customer.id }) : Promise.resolve(null),
    r.createdAgentId ? prisma.agent.findUnique({ where: { id: r.createdAgentId }, select: { id: true, agentId: true, requiredDocs: true, documents: { select: { docType: true, docApprovalStatus: true } } } }) : Promise.resolve(null),
  ])
  const canManage = (await requirePermission('agent-requests', 'manage')).ok
  const { bvn, ...rest } = r
  // After approval: where the new agent is with their own documents (reviewed on the agent's page).
  const agentOut = newAgent && (() => {
    const required = parseRequiredDocs(newAgent.requiredDocs)
    return {
      id: newAgent.id, agentId: newAgent.agentId, documents: documentsState(required, newAgent.documents),
      docs: required.map(t => ({ label: agentDocLabel(t), status: newAgent.documents.find(d => d.docType === t)?.docApprovalStatus ?? 'missing' })),
    }
  })()
  return NextResponse.json({ request: { ...rest, bvnLast4: bvn ? bvn.slice(-4) : null }, summary, blockers, conflict, newAgent: agentOut, canManage })
}
