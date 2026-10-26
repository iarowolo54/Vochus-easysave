import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

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
      customer: {
        id: l.customer.id,
        name: `${l.customer.firstName} ${l.customer.lastName}`,
        customerId: l.customer.customerId,
        phone: l.customer.phone,
      },
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, principal, durationDays, interestRate } = body
  const p = parseFloat(principal)
  const days = parseInt(durationDays)
  const rate = parseFloat(interestRate)

  if (!isFinite(p) || p <= 0) return NextResponse.json({ error: 'Principal must be a positive amount' }, { status: 400 })
  if (!isFinite(days) || days <= 0) return NextResponse.json({ error: 'Duration must be a positive number of days' }, { status: 400 })
  if (!isFinite(rate) || rate < 0) return NextResponse.json({ error: 'Interest rate cannot be negative' }, { status: 400 })

  const interest = (p * rate) / 100
  const total = p + interest

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + days)

  const loanCount = await prisma.loan.count()
  const ref = `LNR-${String(800 + loanCount + 1).padStart(5, '0')}`

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
    details: `Loan request ${ref} ₦${p} for ${loan.customer.firstName} ${loan.customer.lastName} (${loan.customer.customerId}) — ${days} days @ ${rate}%`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ loan }, { status: 201 })
}
