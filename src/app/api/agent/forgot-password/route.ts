import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function POST(req: NextRequest) {
  const { identifier } = await req.json()
  if (!identifier) return NextResponse.json({ error: 'Agent ID or phone required' }, { status: 400 })

  const id = identifier.trim()
  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { agentId: id.toUpperCase() },
        { agentId: id },
        { phone: id },
      ],
    },
  })

  if (!agent || !agent.email) {
    return NextResponse.json({ error: 'No account found, or no email on file' }, { status: 404 })
  }

  const code = genOtp()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  const email = agent.email

  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.emailOTP.create({ data: { email, code, expiresAt } })

  await sendMail({
    to: email,
    subject: 'Vochus Easy Save — Agent Password Reset Code',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
        <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
          <div style="text-align:center;margin-bottom:20px">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#0D6B3A,#1DC96A);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff">V</div>
            <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Agent Password Reset</div>
          </div>
          <p style="font-size:14px;color:#444;margin:0 0 16px">Your password reset code is:</p>
          <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#0e4d24;margin-bottom:16px;font-family:monospace">
            ${code}
          </div>
          <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. If you did not request this, ignore this email.</p>
        </div>
      </div>
    `,
  })

  const masked = email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
  return NextResponse.json({ sent: true, maskedEmail: masked })
}
