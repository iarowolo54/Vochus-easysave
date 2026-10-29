import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateGender, validateState, normalizeLga } from '@/lib/customer-fields'
import { logAudit } from '@/lib/audit'
import { PLATFORM_SAVINGS_FEE, AGENT_SAVINGS_COMMISSION } from '@/lib/wallet-rates'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status') ?? ''
  const planFilter = searchParams.get('plan') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '10')
  const skip = (page - 1) * limit

  const where: any = {
    agentId: agent.id,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { phone: { contains: search } },
            { customerId: { contains: search } },
          ],
        }
      : {}),
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        savingsPlans: { orderBy: { startDate: 'desc' } },
        loans: { where: { status: { in: ['Disbursed', 'Pending', 'Approved'] } }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.customer.count({ where }),
  ])

  const eligiblePlanIds = customers.flatMap(c => c.savingsPlans.filter(p => p.status !== 'Redeemed' && p.balance > 0).map(p => p.id))
  const cashDepositPlanIds = new Set(
    eligiblePlanIds.length
      ? (await prisma.transaction.findMany({
          where: { planId: { in: eligiblePlanIds }, type: 'saving', NOT: { method: 'Paystack' } },
          select: { planId: true },
          distinct: ['planId'],
        })).map(t => t.planId)
      : [],
  )

  let result = customers.map(c => {
    const activePlans = c.savingsPlans.filter(p => p.status === 'Active')
    const savingsBalance = activePlans.reduce((s, p) => s + p.balance, 0)
    const activeLoan = c.loans[0] ?? null
    const plan = activePlans[0]
    const latestPlan = c.savingsPlans[0]
    const planStatus = plan ? 'Active' : (latestPlan?.status ?? null)
    return {
      id: c.id,
      customerId: c.customerId,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      address: c.address,
      status: c.status,
      createdAt: c.createdAt,
      savingsBalance,
      planDays: plan?.periodDays ?? null,
      planId: plan?.id ?? null,
      planStatus,
      dailyAmount: plan?.dailyAmount ?? null,
      activeLoan: activeLoan
        ? { ref: activeLoan.ref, totalAmount: activeLoan.totalAmount, status: activeLoan.status }
        : null,
      savingsPlans: c.savingsPlans.map(p => ({ ...p, hasCashDeposit: cashDepositPlanIds.has(p.id) })),
      nokName: c.nokName,
      nokRelation: c.nokRelation,
      nokPhone: c.nokPhone,
      language: c.language,
      dob: c.dob,
      bvn: c.bvn,
      gender: c.gender,
      state: c.state,
      lga: c.lga,
      photoUrl: c.photoUrl,
    }
  })

  if (planFilter) {
    const days = parseInt(planFilter)
    result = result.filter(c => c.planDays === days)
  }

  return NextResponse.json({ customers: result, total, page, limit })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { firstName, lastName, phone, email, dob, address, language, gender, state, lga, bvn, nokName, nokRelation, nokPhone, dailyAmount, periodDays, goal, startDate, notes, registrationFee, feeMethod, cadence, plans } = body

  // Gender required (Female/Male); state optional but validated (#18).
  const genderCheck = validateGender(gender)
  if (!genderCheck.ok) return NextResponse.json({ error: genderCheck.error }, { status: 400 })
  const stateCheck = validateState(state)
  if (!stateCheck.ok) return NextResponse.json({ error: stateCheck.error }, { status: 400 })

  const last = await prisma.customer.findFirst({ orderBy: { customerId: 'desc' } })
  const lastNum = last ? parseInt(last.customerId.replace('CST-', ''), 10) : 0
  const customerId = `CST-${String(lastNum + 1).padStart(5, '0')}`

  const start = startDate ? new Date(startDate) : new Date()
  const maturity = new Date(start)
  maturity.setDate(maturity.getDate() + parseInt(periodDays))

  const customer = await prisma.customer.create({
    data: {
      customerId,
      agentId: agent.id,
      firstName,
      lastName,
      phone,
      email: email || null,
      dob: dob ? new Date(dob) : null,
      address,
      language: language ?? 'English',
      gender: genderCheck.value,
      state: stateCheck.value,
      lga: normalizeLga(lga),
      bvn: bvn || null,
      nokName: nokName || '',
      nokRelation: nokRelation || '',
      nokPhone: nokPhone || '',
    },
  })

  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: customer.id,
      dailyAmount: parseFloat(dailyAmount),
      periodDays: parseInt(periodDays),
      goal,
      cadence: cadence ?? 'daily',
      startDate: start,
      maturityDate: maturity,
      balance: 0,
      notes: notes || null,
    },
  })

  const txnCount = await prisma.transaction.count()
  const ref = `ENR-${String(txnCount + 1).padStart(5, '0')}`

  await prisma.transaction.create({
    data: {
      ref,
      agentId: agent.id,
      customerId: customer.id,
      planId: plan.id,
      type: 'enrolment',
      amount: 0,
      method: 'Cash',
      status: 'Done',
    },
  })

  // Additional plans beyond the first (multi-plan enrolment)
  if (Array.isArray(plans) && plans.length > 1) {
    for (let i = 0; i < plans.length - 1; i++) {
      const p = plans[i + 1]
      if (!p?.dailyAmount || !p?.periodDays || !p?.goal) continue
      // Plans may share a start date now that the (customerId, startDate) unique
      // index is gone; no more per-plan +1s bump.
      const pStart = p.startDate ? new Date(p.startDate) : new Date()
      const pMat = new Date(pStart); pMat.setDate(pMat.getDate() + parseInt(p.periodDays))
      await prisma.savingsPlan.create({
        data: {
          customerId: customer.id,
          dailyAmount: parseFloat(p.dailyAmount),
          periodDays: parseInt(p.periodDays),
          goal: p.goal,
          cadence: p.cadence ?? 'daily',
          startDate: pStart,
          maturityDate: pMat,
          balance: 0,
          notes: p.notes || null,
        },
      })
    }
  }

  const fee = registrationFee ? money(parseFloat(registrationFee)) : 0
  if (fee > 0) {
    try {
      assertSufficient('Agent wallet', agent.walletBalance, fee)
    } catch (e) {
      if (e instanceof InsufficientFundsError) return insufficientResponse(e)
      throw e
    }

    const feeTxnCount = await prisma.transaction.count()
    const feeRef = `REG-${String(feeTxnCount + 1).padStart(5, '0')}`
    const cardCost = money(Math.min(300, fee))
    const revenue = money(fee - cardCost)

    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          ref: feeRef,
          agentId: agent.id,
          customerId: customer.id,
          planId: plan.id,
          type: 'registration',
          amount: fee,
          method: 'Cash',
          status: 'Done',
        },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: { walletBalance: { decrement: fee } },
      }),
      prisma.platformWallet.upsert({
        where: { type: 'CardCost' },
        update: { balance: { increment: cardCost } },
        create: { type: 'CardCost', balance: cardCost },
      }),
      prisma.platformWallet.upsert({
        where: { type: 'Revenue' },
        update: { balance: { increment: revenue } },
        create: { type: 'Revenue', balance: revenue },
      }),
    ])
  }

  logAudit({ action: 'enrolment', entity: 'Customer', entityId: customer.id, details: `Customer enrolled — ${customer.firstName} ${customer.lastName} (${customer.customerId})`, actorId: agent.id, actorName: agent.name })

  return NextResponse.json({ customer, plan }, { status: 201 })
}
