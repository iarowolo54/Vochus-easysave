import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite || invite.status === 'Completed' || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  }

  await prisma.emailOTP.deleteMany({ where: { email: invite.email } })

  const code = randomInt(100000, 1000000).toString()
  await prisma.emailOTP.create({
    data: { email: invite.email, code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  })

  await sendMail({
    to: invite.email,
    subject: 'Your Vochus Easy Save verification code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a5c35">Email Verification</h2>
        <p>Use the code below to verify your email address during agent onboarding.</p>
        <div style="text-align:center;margin:28px 0">
          <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#1a5c35;font-family:monospace">${code}</div>
        </div>
        <p style="color:#888;font-size:12px">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `,
  })

  return NextResponse.json({ sent: true })
}
