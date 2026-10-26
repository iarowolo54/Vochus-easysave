import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite || invite.status === 'Completed' || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 })

  const otp = await prisma.emailOTP.findFirst({
    where: { email: invite.email, code, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  await prisma.emailOTP.update({ where: { id: otp.id }, data: { verified: true } })

  return NextResponse.json({ verified: true })
}
