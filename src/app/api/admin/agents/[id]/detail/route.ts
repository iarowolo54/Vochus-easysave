import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      customers: {
        include: {
          savingsPlans: { include: { transactions: { orderBy: { createdAt: 'desc' } } } },
          loans: { include: { repayments: true }, orderBy: { createdAt: 'desc' } },
          memberCards: { select: { serial: true, status: true, linkedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      transactions: { orderBy: { createdAt: 'desc' }, take: 200 },
      memberCards: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ agent })
}
