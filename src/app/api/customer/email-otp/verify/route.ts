import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { email, code } = await req.json()
  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code required' }, { status: 400 })
  }

  const otp = await prisma.emailOTP.findFirst({
    where: { email, code, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await prisma.emailOTP.update({ where: { id: otp.id }, data: { verified: true } })

  return NextResponse.json({ verified: true })
}
