import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { approveUpgradeRequest } from '@/lib/agent-upgrade'
import { emailApproved } from '@/lib/agent-upgrade-email'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agent-requests', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await approveUpgradeRequest(prisma, { id, admin: guard.actor })
  if (!r.ok) return NextResponse.json({ error: r.error, blockers: r.blockers }, { status: r.status })
  void emailApproved({ email: r.email, customerName: r.customerName, newAgentCode: r.newAgentCode, requester: r.requester })
  return NextResponse.json({ ok: true, newAgentCode: r.newAgentCode })
}
