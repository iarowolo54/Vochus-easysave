import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { rate, label } = body
  const parsedRate = parseFloat(rate)
  if (!isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
    return NextResponse.json({ error: 'Rate must be between 0 and 100' }, { status: 400 })
  }

  const updated = await prisma.interestRate.update({
    where: { id },
    data: { rate: parsedRate, ...(label ? { label } : {}) },
  })

  return NextResponse.json({ rate: updated })
}
