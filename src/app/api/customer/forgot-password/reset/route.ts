import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { INVALID_CODE_MESSAGE, limitByIp, readBody, text, verifyResetCode } from '@/lib/password-reset'

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'guess')
  if (limited) return limited

  const body = await readBody(req)
  const phone = text(body.phone)
  const code = text(body.code)
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (!phone || !code || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { phone } })
  if (!customer || !(await verifyResetCode('customer', customer.id, code))) {
    return NextResponse.json({ error: INVALID_CODE_MESSAGE }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  // A reset ends every existing session and fingerprint sign-in on the account.
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customer.id }, data: { password: hashed, tokenVersion: { increment: 1 } } }),
    prisma.biometricToken.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])

  await logAudit({
    action: 'customer_password_reset',
    entity: 'Customer',
    entityId: customer.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) reset password via forgot-password flow`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ success: true })
}
