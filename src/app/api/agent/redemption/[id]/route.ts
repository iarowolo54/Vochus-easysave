import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { notifySuperAdminsRedemptionPending } from '@/lib/redemption-notify'
import { getPayoutMode } from '@/lib/payout-mode'
import { customerType } from '@/lib/customer-type'
import { notifyCustomerRedemptionDeclined } from '@/lib/payout-notify'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const records = await prisma.earlyRedemption.findMany({
    where: {
      status: 'TokenValidated',
      savingsPlan: { customer: { agentId: agent.id } },
    },
    include: {
      savingsPlan: {
        include: {
          customer: { select: { firstName: true, lastName: true, customerId: true, phone: true } },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
  })

  return NextResponse.json({ records: records.map(r => ({
    id: r.id,
    ref: r.ref,
    type: r.type,
    reason: r.reason,
    status: r.status,
    balance: r.balance,
    penalty: r.penalty,
    netPayout: r.netPayout,
    payoutMethod: r.payoutMethod,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    bankName: r.bankName,
    requestedAt: r.requestedAt,
    customerName: `${r.savingsPlan.customer.firstName} ${r.savingsPlan.customer.lastName}`,
    customerId: r.savingsPlan.customer.customerId,
    customerPhone: r.savingsPlan.customer.phone,
  })) })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id } = await params
  const { action } = await req.json()
  if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const redemption = await prisma.earlyRedemption.findUnique({
    where: { id },
    include: { savingsPlan: { include: { customer: true } } },
  })
  if (!redemption) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (redemption.savingsPlan.customer.agentId !== agent.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (redemption.status !== 'TokenValidated') {
    return NextResponse.json({ error: 'Not ready for agent approval' }, { status: 409 })
  }

  const customerName = `${redemption.savingsPlan.customer.firstName} ${redemption.savingsPlan.customer.lastName}`

  if (action === 'reject') {
    const declined = await prisma.earlyRedemption.updateMany({
      where: { id, status: 'TokenValidated' },
      data: { status: 'Rejected', decidedAt: new Date(), decidedBy: agent.agentId },
    })
    if (declined.count === 0) return NextResponse.json({ error: 'Not ready for agent approval' }, { status: 409 })
    logAudit({
      action: 'agent_redemption_rejected',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `Agent ${agent.name} (${agent.agentId}) rejected redemption ${redemption.ref} for ${customerName}`,
      actorType: 'agent',
      actorId: agent.id,
      actorName: agent.name,
    })
    // Manual mode: tell the customer. Isolated — the reject is already committed.
    try {
      if ((await getPayoutMode()).customer === 'manual') {
        const cust = redemption.savingsPlan.customer
        const plans = await prisma.savingsPlan.findMany({ where: { customerId: cust.id }, select: { source: true } })
        await notifyCustomerRedemptionDeclined(cust, customerType(plans), {
          amountNaira: redemption.netPayout,
          ref: redemption.ref,
          reason: 'declined by your agent',
        })
      }
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ ok: true, status: 'Rejected' })
  }

  const approved = await prisma.earlyRedemption.updateMany({
    where: { id, status: 'TokenValidated' },
    data: {
      status: 'AgentApproved',
      agentApprovedAt: new Date(),
      agentApprovedBy: agent.agentId,
    },
  })
  if (approved.count === 0) return NextResponse.json({ error: 'Not ready for agent approval' }, { status: 409 })

  logAudit({
    action: 'agent_redemption_approved',
    entity: 'EarlyRedemption',
    entityId: id,
    details: `Agent ${agent.name} (${agent.agentId}) approved redemption ${redemption.ref} for ${customerName} — sent to admin`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  // The redemption has now reached the admin-approval stage — tell the super admins it is
  // awaiting their final approval. Fire-and-forget; never throws.
  notifySuperAdminsRedemptionPending(prisma, {
    customerName,
    amountNaira: redemption.netPayout,
    planGoal: redemption.savingsPlan.goal,
    ref: redemption.ref,
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: 'AgentApproved', message: 'Sent to admin for final approval' })
}
