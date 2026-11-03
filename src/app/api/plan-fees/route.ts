import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { getCommissionRates } from '@/lib/commission-rates'
import { buildPlanFees, isNewModelLive } from '@/lib/commission-ledger'

// What the plan screens need to describe the savings fee. Agents and customers only.
export async function GET() {
  const agent = await getServerSession(authOptions)
  const customer = agent?.user ? null : await getCustomerSession()
  if (!agent?.user && !customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [live, rates] = await Promise.all([isNewModelLive(prisma, new Date()), getCommissionRates(prisma)])
  return NextResponse.json(buildPlanFees(live, rates))
}
