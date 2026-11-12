import { matchesCustomer } from '@/lib/fuzzy-search'
import { ajoPlanFees } from '@/lib/ajo-fee'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { asCustomerType } from '@/lib/customer-type'
import { money } from '@/lib/wallet-guard'
import { latestPhotoRequests } from '@/lib/customer-photo-request'
import { photoStatusOf } from '@/lib/photo-deadline'

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

  const searchTerms = search.slice(0, 100).trim().split(/\s+/).filter(Boolean).slice(0, 5)

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
    ...(typeFilter === 'online' || typeFilter === 'offline' ? { type: typeFilter } : {}),
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
  // What collecting each Ajo pot will cost, from the server's own rule, so the screen never estimates it.
  const ajoFees = await ajoPlanFees(prisma, customers.flatMap(c => c.savingsPlans.filter(p => p.cadence === 'ajo')))
  const cashDepositPlanIds = new Set(
    eligiblePlanIds.length
      ? (await prisma.transaction.findMany({
          where: { planId: { in: eligiblePlanIds }, type: 'saving', NOT: { method: 'Paystack' } },
          select: { planId: true },
          distinct: ['planId'],
        })).map(t => t.planId)
      : [],
  )

  const photoReqs = await latestPhotoRequests(prisma, customers.map(c => c.id))
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
      type: asCustomerType(c.type),
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
      savingsPlans: c.savingsPlans.map(p => ({ ...p, hasCashDeposit: cashDepositPlanIds.has(p.id), ajoFee: ajoFees.get(p.id)?.fee })),
      nokName: c.nokName,
      nokRelation: c.nokRelation,
      nokPhone: c.nokPhone,
      language: c.language,
      dob: c.dob,
      bvn: c.bvn,
      gender: c.gender,
      state: c.state,
      lga: c.lga,
      // A link, not the base64 photo: a page of customers would otherwise carry several MB.
      photoUrl: c.photoUrl ? `/api/customers/${c.id}/photo` : null,
      ...(({ status, rejectReason }) => ({ photoStatus: status, photoRejectReason: rejectReason }))(photoStatusOf(!!c.photoUrl, photoReqs.get(c.id) ?? null)),
      // Whether the account is locked to a phone; the device id itself is never sent.
      deviceBound: c.boundDeviceId != null,
    }
  })

  let summary: { overdueCount: number; expectedToday: number; saverCount: number } | undefined
  if (typeFilter === 'offline') {
    // Whole offline set for this agent, ignoring search/page/limit/status/plan.
    const offline = await prisma.customer.findMany({
      where: { agentId: agent.id, type: 'offline' },
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
