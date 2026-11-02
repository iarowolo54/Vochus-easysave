import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { unlockAccount } from '@/lib/login-attempt'
import { INVALID_CODE_MESSAGE, limitByIp, readBody, redeemResetCode, text } from '@/lib/password-reset'

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
  const redeemed = customer ? await redeemResetCode('customer', customer.id, text(body.resetId), code) : null
  if (!customer || !redeemed) {
    return NextResponse.json({ error: INVALID_CODE_MESSAGE }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  // A reset ends every existing session and fingerprint sign-in on the account.
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customer.id }, data: { password: hashed, tokenVersion: { increment: 1 } } }),
    prisma.biometricToken.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])

  // Proving the code proves the owner, so a stranger's failed sign-ins mustn't keep them out.
  await unlockAccount(customer.phone).catch(() => console.error('Sign-in lock could not be cleared after a reset'))

  await logAudit({
    action: 'customer_password_reset',
    entity: 'Customer',
    entityId: customer.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) reset password via forgot-password flow${redeemed === 'admin' ? ' with a code sent by an administrator' : ''}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ success: true })
}
