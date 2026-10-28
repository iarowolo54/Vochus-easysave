import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'

export async function POST(req: NextRequest) {
  const { phone } = await req.json()

  if (!phone || !/^0[7-9][01]\d{8}$/.test(phone.replace(/\s/g, ''))) {
    return NextResponse.json({ error: 'Invalid Nigerian phone number' }, { status: 400 })
  }

  const code = randomInt(100000, 1000000).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await prisma.phoneOTP.create({ data: { phone, code, expiresAt } })

  const smsResult = await sendSMS(phone, `Your Vochus Easy Save verification code is: ${code}. Valid for 10 minutes.`)

  if (!smsResult.success) {
    return NextResponse.json({ error: smsResult.error ?? 'Failed to send OTP. Try again.' }, { status: 500 })
  }

  const customer = await prisma.customer.findFirst({ where: { phone }, select: { email: true, firstName: true } })
  if (customer?.email) {
    sendMail({
      to: customer.email,
      subject: 'Your Vochus Easy Save verification code',
      html: `<p>Hi ${customer.firstName},</p><p>Your verification code is: <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes. Do not share this code with anyone.</p>`,
    }).catch(() => {})
  }

  // The code is delivered out-of-band (SMS, and email if the number is known).
  // It is never returned in the response or logged.
  return NextResponse.json({ ok: true })
}
