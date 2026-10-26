import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const { phone, code, newPassword } = await req.json()
  if (!phone || !code || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const cleanPhone = phone.trim()
  const customer = await prisma.customer.findFirst({ where: { phone: cleanPhone } })
  if (!customer) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  // Accept the OTP if it matches EITHER the email OTP or the phone OTP for this customer.
  const [emailOtp, phoneOtp] = await Promise.all([
    customer.email
      ? prisma.emailOTP.findFirst({
          where: { email: customer.email, code, expiresAt: { gte: new Date() } },
          orderBy: { createdAt: 'desc' },
        })
      : null,
    prisma.phoneOTP.findFirst({
      where: { phone: cleanPhone, code, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  if (!emailOtp && !phoneOtp) {
    return NextResponse.json({ error: 'Invalid or expired code — request a new one' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.customer.update({ where: { id: customer.id }, data: { password: hashed } })
  if (customer.email) await prisma.emailOTP.deleteMany({ where: { email: customer.email } })
  await prisma.phoneOTP.deleteMany({ where: { phone: cleanPhone } })

  logAudit({
    action: 'customer_password_reset',
    entity: 'Customer',
    entityId: customer.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) reset password via forgot-password flow (${phoneOtp ? 'SMS' : 'email'})`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ success: true })
}
