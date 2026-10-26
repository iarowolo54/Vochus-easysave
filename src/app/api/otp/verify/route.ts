import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json()

  const otp = await prisma.phoneOTP.findFirst({
    where: { phone, code, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await prisma.phoneOTP.update({ where: { id: otp.id }, data: { verified: true } })

  return NextResponse.json({ ok: true })
}
