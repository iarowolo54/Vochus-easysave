import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parseStoredPlans } from '@/lib/customer-request'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await prisma.customerRequest.findUnique({
    where: { id },
    include: { agent: { select: { name: true, agentId: true, walletBalance: true } } },
  })
  if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  const { plans, bvn, pendingPhone: _phone, pendingEmail: _email, ...rest } = r
  return NextResponse.json({ ...rest, plans: parseStoredPlans(plans), bvnLast4: bvn ? bvn.slice(-4) : null })
}
