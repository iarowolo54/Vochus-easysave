import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const code = genOtp()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.emailOTP.create({ data: { email, code, expiresAt } })

  await sendMail({
    to: email,
    subject: 'Vochus Easy Save — Email Verification Code',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
        <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
          <div style="text-align:center;margin-bottom:20px">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#2ecc71,#1a6b3a);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;font-family:sans-serif">V</div>
            <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Vochus Easy Save</div>
          </div>
          <p style="font-size:14px;color:#444;margin:0 0 16px">Your email verification code is:</p>
          <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#1a6b3a;margin-bottom:16px;font-family:monospace">
            ${code}
          </div>
          <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        </div>
      </div>
    `,
  })

  return NextResponse.json({ sent: true })
}
