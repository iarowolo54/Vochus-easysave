import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

// Explicit selects only: never return password/PIN hashes, tokens, BVN/NIN, device ids or base64 blobs.
const txSelect = {
  id: true, ref: true, type: true, amount: true, method: true, status: true, note: true, createdAt: true,
} as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response

  const { id } = await params

  const row = await prisma.agent.findUnique({
    where: { id },
    select: {
      id: true, agentId: true, name: true, phone: true, email: true, location: true,
      walletBalance: true, status: true, createdAt: true,
      bankName: true, accountNumber: true, accountName: true,
      boundDeviceId: true, // reduced to a boolean below, never returned
      customers: {
        select: {
          id: true, customerId: true, firstName: true, lastName: true, phone: true, email: true,
          address: true, status: true, createdAt: true,
          savingsPlans: {
            select: {
              id: true, goal: true, dailyAmount: true, periodDays: true, balance: true, status: true,
              startDate: true, maturityDate: true, notes: true,
              transactions: { select: txSelect, orderBy: { createdAt: 'desc' } },
            },
          },
          loans: {
            select: {
              id: true, ref: true, principal: true, totalAmount: true, interestRate: true,
              durationDays: true, dueDate: true, status: true, createdAt: true,
              repayments: { select: { id: true, amount: true, createdAt: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          memberCards: { select: { serial: true, status: true, linkedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      transactions: { select: txSelect, orderBy: { createdAt: 'desc' }, take: 200 },
      memberCards: { select: { serial: true, status: true }, orderBy: { createdAt: 'desc' } },
    },
  })

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { boundDeviceId, ...agent } = row
  return NextResponse.json({ agent: { ...agent, deviceBound: Boolean(boundDeviceId) } })
}
