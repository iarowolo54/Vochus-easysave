import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
