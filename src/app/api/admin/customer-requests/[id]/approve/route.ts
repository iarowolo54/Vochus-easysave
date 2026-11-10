import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { approveCustomerRequest } from '@/lib/customer-request'
import { emailRequestApproved, textCustomerWelcome } from '@/lib/customer-request-email'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await approveCustomerRequest(prisma, { id, admin: guard.actor })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  void emailRequestApproved(r.agent, { customerName: r.customerName, customerCode: r.customerCode, fee: r.fee })
  void textCustomerWelcome(r.customer, { customerCode: r.customerCode, agentName: r.agent.name })
  return NextResponse.json({ ok: true, customerCode: r.customerCode, cardNotLinked: r.hadCard && !r.cardLinked })
}
