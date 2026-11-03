import { matchesCustomer } from '@/lib/fuzzy-search'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { customerType } from '@/lib/customer-type'
import { validateGender, validateState, validateLga } from '@/lib/customer-fields'
import { logAudit } from '@/lib/audit'
import { normalizePhone } from '@/lib/phone'
import { normalizeEmail } from '@/lib/email'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
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
  const typeFilter = searchParams.get('type')
  const sortLastPaid = searchParams.get('sort') === 'lastPaid'
  const planDays = planFilter ? parseInt(planFilter) : NaN

  const searchTerms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5)

  // Typo-tolerant search: match in memory over this agent's own customers (names and phone only,
  // no blobs), then filter the real query by the matching ids.
  let matchedIds: string[] | null = null
  if (searchTerms.length) {
    const pool = await prisma.customer.findMany({
      where: { agentId: agent.id },
      select: { id: true, firstName: true, lastName: true, phone: true, customerId: true },
    })
    matchedIds = pool.filter(c => matchesCustomer(searchTerms, c)).map(c => c.id)
  }

  const where: Prisma.CustomerWhereInput = {
    agentId: agent.id,
    ...(matchedIds ? { id: { in: matchedIds } } : {}),
    ...(status ? { status } : {}),
    ...(typeFilter === 'online' ? { savingsPlans: { some: { source: 'self' } } } : {}),
    ...(typeFilter === 'offline' ? { savingsPlans: { none: { source: 'self' } } } : {}),
  }
  // Plan-length filter lives in the where (before paging) so pages and total are right.
  // It is a second savingsPlans condition, so combine with AND rather than overwrite the type clause.
  if (!Number.isNaN(planDays)) {
    where.AND = [{ savingsPlans: { some: { status: 'Active', periodDays: planDays } } }]
  }

  const lastPaidMap = async (ids: string[]) => {
    const map = new Map<string, Date>()
    if (!ids.length) return map
    const rows = await prisma.transaction.groupBy({
      by: ['customerId'],
      where: { customerId: { in: ids }, type: 'saving', status: 'Done' },
      _max: { createdAt: true },
    })
    for (const r of rows) if (r.customerId && r._max.createdAt) map.set(r.customerId, r._max.createdAt)
    return map
  }

  const include = {
    savingsPlans: { orderBy: { startDate: 'desc' } },
    loans: { where: { status: { in: ['Disbursed', 'Pending', 'Approved'] } }, take: 1 },
  } satisfies Prisma.CustomerInclude

  let customers: Prisma.CustomerGetPayload<{ include: typeof include }>[]
  let total: number
  let lastPaid: Map<string, Date>

  if (sortLastPaid) {
    // Sort needs every filtered row's last-paid time: fetch ids, sort in memory, slice, then load the page.
    const all = await prisma.customer.findMany({ where, select: { id: true, createdAt: true } })
    total = all.length
    lastPaid = await lastPaidMap(all.map(c => c.id))
    all.sort((x, y) => {
      const lx = lastPaid.get(x.id)?.getTime() ?? -Infinity
      const ly = lastPaid.get(y.id)?.getTime() ?? -Infinity
      return lx !== ly ? lx - ly : y.createdAt.getTime() - x.createdAt.getTime()
    })
    const pageIds = all.slice(skip, skip + limit).map(c => c.id)
    const rows = await prisma.customer.findMany({ where: { id: { in: pageIds }, agentId: agent.id }, include })
    const byId = new Map(rows.map(r => [r.id, r]))
    customers = pageIds.flatMap(id => byId.get(id) ?? [])
  } else {
    ;[customers, total] = await Promise.all([
      prisma.customer.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.customer.count({ where }),
    ])
    lastPaid = await lastPaidMap(customers.map(c => c.id))
  }

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

  const result = customers.map(c => {
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
      type: customerType(c.savingsPlans),
      lastPaidAt: lastPaid.get(c.id)?.toISOString() ?? null,
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

  let summary: { overdueCount: number; expectedToday: number; saverCount: number } | undefined
  if (typeFilter === 'offline') {
    // Whole offline set for this agent, ignoring search/page/limit/status/plan.
    const offline = await prisma.customer.findMany({
      where: { agentId: agent.id, savingsPlans: { none: { source: 'self' } } },
      select: { id: true, savingsPlans: { where: { status: 'Active' }, select: { dailyAmount: true, cadence: true } } },
    })
    const savers = offline.filter(c => c.savingsPlans.length > 0)
    const paid = await lastPaidMap(savers.map(c => c.id))
    const lagosDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    const today = Date.parse(lagosDay(new Date()))
    const overdueCount = savers.filter(c => {
      const last = paid.get(c.id)
      return !last || Math.round((today - Date.parse(lagosDay(last))) / 86_400_000) >= 3
    }).length
    const expectedToday = money(
      savers.reduce((sum, c) => sum + c.savingsPlans.filter(p => p.cadence === 'daily').reduce((s, p) => s + p.dailyAmount, 0), 0),
    )
    summary = { overdueCount, expectedToday, saverCount: savers.length }
  }

  return NextResponse.json({ customers: result, total, page, limit, ...(summary ? { summary } : {}) })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { firstName, lastName, phone, email, dob, address, language, gender, state, lga, bvn, nokName, nokRelation, nokPhone, dailyAmount, periodDays, goal, startDate, notes, registrationFee, feeMethod, cadence, plans } = body

  if (typeof phone !== 'string' || !phone.trim()) return NextResponse.json({ error: 'Phone is required' }, { status: 400 })

  // Gender, state and LGA required; the LGA must belong to the state (#18).
  const genderCheck = validateGender(gender)
  if (!genderCheck.ok) return NextResponse.json({ error: genderCheck.error }, { status: 400 })
  const stateCheck = validateState(state)
  if (!stateCheck.ok) return NextResponse.json({ error: stateCheck.error }, { status: 400 })
  const lgaCheck = validateLga(stateCheck.value, lga)
  if (!lgaCheck.ok) return NextResponse.json({ error: lgaCheck.error }, { status: 400 })

  const last = await prisma.customer.findFirst({ orderBy: { customerId: 'desc' } })
  const lastNum = last ? parseInt(last.customerId.replace('CST-', ''), 10) : 0
  const customerId = `CST-${String(lastNum + 1).padStart(5, '0')}`

  const start = startDate ? new Date(startDate) : new Date()
  const maturity = new Date(start)
  maturity.setDate(maturity.getDate() + parseInt(periodDays))

  // One identity, one account: the phone/email must not belong to any account.
  const conflict = await findIdentityConflict(prisma, { phone, email })
  if (conflict) return identityConflictResponse(conflict)

  const customer = await prisma.customer.create({
    data: {
      customerId,
      agentId: agent.id,
      firstName,
      lastName,
      phone: normalizePhone(String(phone)),
      email: email ? normalizeEmail(String(email)) : null,
      dob: dob ? new Date(dob) : null,
      address,
      language: language ?? 'English',
      gender: genderCheck.value,
      state: stateCheck.value,
      lga: lgaCheck.value,
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
