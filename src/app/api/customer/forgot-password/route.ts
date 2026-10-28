import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { emailLogo } from '@/lib/email-brand'
import { sendSMS } from '@/lib/kudisms'

function genOtp() {
  return randomInt(100000, 1000000).toString()
}

function maskPhone(p: string) {
  if (p.length < 6) return p
  return p.slice(0, 4) + '****' + p.slice(-3)
}

export async function POST(req: NextRequest) {
  const { phone } = await req.json()
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 })

  const customer = await prisma.customer.findFirst({ where: { phone: phone.trim() } })
  if (!customer) {
    return NextResponse.json({ error: 'No account found with that phone number' }, { status: 404 })
  }

  const code = genOtp()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  // Prefer email if we have it, otherwise fall back to SMS.
  if (customer.email) {
    const email = customer.email
    await prisma.emailOTP.deleteMany({ where: { email } })
    await prisma.emailOTP.create({ data: { email, code, expiresAt } })

    await sendMail({
      to: email,
      subject: 'Vochus Easy Save — Password Reset Code',
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
          <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
            <div style="text-align:center;margin-bottom:20px">
              ${emailLogo()}
              <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Password Reset</div>
            </div>
            <p style="font-size:14px;color:#444;margin:0 0 16px">Your password reset code is:</p>
            <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#1a6b3a;margin-bottom:16px;font-family:monospace">
              ${code}
            </div>
            <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. If you did not request this, ignore this email.</p>
          </div>
        </div>
      `,
    })

    const masked = email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
    return NextResponse.json({ sent: true, channel: 'email', maskedTarget: masked })
  }

  // No email on file — send OTP via SMS
  const cleanPhone = customer.phone.trim()
  await prisma.phoneOTP.deleteMany({ where: { phone: cleanPhone } })
  await prisma.phoneOTP.create({ data: { phone: cleanPhone, code, expiresAt } })

  const smsResult = await sendSMS(cleanPhone, `Your Vochus Easy Save password reset code is ${code}. Valid for 10 minutes. Do not share.`)
  if (!smsResult.success) {
    return NextResponse.json({ error: smsResult.error ?? 'Could not send SMS. Please try again in a moment.' }, { status: 500 })
  }

  return NextResponse.json({ sent: true, channel: 'sms', maskedTarget: maskPhone(cleanPhone) })
}
