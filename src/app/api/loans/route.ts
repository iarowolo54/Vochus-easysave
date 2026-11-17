import { NextRequest, NextResponse } from 'next/server'
import { genTxnRef } from '@/lib/ref'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { checkLoanEligibility, loadLoanEligibilityContext } from '@/lib/loan-eligibility'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''

  const where: any = { agentId: agent.id }
  if (status) {
    const statuses = status.split(',').map(s => s.trim())
    where.status = { in: statuses }
  }

  const loans = await prisma.loan.findMany({
    where,
    include: {
      customer: true,
      repayments: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    loans: loans.map(l => ({
      id: l.id,
      ref: l.ref,
      principal: l.principal,
      interestRate: l.interestRate,
      interestAmount: l.interestAmount,
      totalAmount: l.totalAmount,
      durationDays: l.durationDays,
      dueDate: l.dueDate,
      status: l.status,
      createdAt: l.createdAt,
      repaid: l.repayments.reduce((s, r) => s + r.amount, 0),
      // A loan outlives a deleted customer (the link is cleared), so a missing one shows as deleted instead of failing the list.
      customer: l.customer
        ? { id: l.customer.id, name: `${l.customer.firstName} ${l.customer.lastName}`, customerId: l.customer.customerId, phone: l.customer.phone }
        : { id: null, name: 'Deleted customer', customerId: '—', phone: '' },
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, principal, durationDays } = body
  const p = parseFloat(principal)
  const days = parseInt(durationDays)

  // Require a real customer id. Without this, `where: { id: undefined, agentId }`
  // would match an arbitrary customer of the acting agent and create a loan with
  // a null customer.
  if (typeof customerId !== 'string' || !customerId) return NextResponse.json({ error: 'A customer is required' }, { status: 400 })
  if (!isFinite(p) || p <= 0) return NextResponse.json({ error: 'Principal must be a positive amount' }, { status: 400 })
  if (!isFinite(days) || days <= 0) return NextResponse.json({ error: 'Duration must be a positive number of days' }, { status: 400 })

  // Customer must belong to the acting agent (closes the cross-agent IDOR),
  // and eligibility is server-authoritative — the 80%-of-savings cap and the
  // one-active-loan rule were previously enforced only in the page. Loading the
  // eligibility context is itself the owner-scoped lookup (null => not owned).
  const eligibility = await loadLoanEligibilityContext(prisma, agent.id, customerId)
  if (!eligibility) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const verdict = checkLoanEligibility({ principal: p, savingsBalance: eligibility.savingsBalance, hasActiveLoan: eligibility.hasActiveLoan })
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 })

  // Interest rate is server-authoritative — the admin-configured rate for this
  // duration, never a rate chosen by the requesting agent.
  const rateConfig = await prisma.interestRate.findUnique({ where: { durationDays: days } })
  if (!rateConfig) return NextResponse.json({ error: 'No interest rate is configured for this loan duration' }, { status: 400 })
  // Honour the admin tier controls (handoff #29): a length can be turned off, or capped.
  if (rateConfig.enabled === false) {
    return NextResponse.json({ error: "This loan length isn't offered right now" }, { status: 400 })
  }
  if (rateConfig.maxAmount != null && p > rateConfig.maxAmount) {
    return NextResponse.json({ error: `The largest loan for ${days} days is ₦${rateConfig.maxAmount.toLocaleString('en-NG')}` }, { status: 400 })
  }
  const rate = rateConfig.rate

  const interest = (p * rate) / 100
  const total = p + interest

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + days)

  const ref = genTxnRef('LNR')

  const loan = await prisma.loan.create({
    data: {
      ref,
      agentId: agent.id,
      customerId,
      principal: p,
      interestRate: rate,
      interestAmount: interest,
      totalAmount: total,
      durationDays: days,
      dueDate,
      status: 'Pending',
    },
    include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
  })

  logAudit({
    action: 'loan_request',
    entity: 'Loan',
    entityId: loan.id,
    details: `Loan request ${ref} ₦${p} for ${loan.customer ? `${loan.customer.firstName} ${loan.customer.lastName} (${loan.customer.customerId})` : 'a deleted customer'} — ${days} days @ ${rate}%`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ loan }, { status: 201 })
}
