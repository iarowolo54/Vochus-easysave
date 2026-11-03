import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getCustomerSession, signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { INVALID_CODE_MESSAGE, redeemResetCode, SIX_DIGITS } from '@/lib/password-reset'
import { checkLoginThrottle, recordLoginFailure, clearLoginThrottle } from '@/lib/login-attempt'

// Step 2: change the password with the current one plus the emailed/SMS code from ./code. Wrong guesses
// count against the same per-account lock as sign-in, so a hijacked session
// can't be used to brute-force the current password.
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const { currentPassword, newPassword, code, resetId } = (body ?? {}) as Record<string, unknown>
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 })
  }
  if (typeof code !== 'string' || !SIX_DIGITS.test(code) || typeof resetId !== 'string') {
    return NextResponse.json({ error: 'Enter the 6-digit code we sent you' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'Use a different password from your current one' }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer?.password) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  // Same gate as sign-in: a customer an administrator has locked can't change credentials.
  if (customer.status && customer.status.toLowerCase() !== 'active') {
    return NextResponse.json({ error: 'Your account has been locked by the administrator. Please contact support.' }, { status: 403 })
  }

  const throttle = await checkLoginThrottle({ phone: customer.phone })
  if (throttle.accountLocked) {
    return NextResponse.json({ error: 'Your account is locked after too many wrong attempts. Unlock it with a verification code.', locked: true }, { status: 423 })
  }

  if (!(await bcrypt.compare(currentPassword, customer.password))) {
    await recordLoginFailure({ phone: customer.phone }).catch(() => {})
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  // Last, so a wrong current password never spends the code.
  if (!(await redeemResetCode('customer', customer.id, resetId, code, Date.now(), 'password_change'))) {
    return NextResponse.json({ error: INVALID_CODE_MESSAGE, badCode: true }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  // Bumping tokenVersion ends every other session; fingerprint sign-in is revoked too.
  const updated = await prisma.$transaction(async tx => {
    const c = await tx.customer.update({ where: { id: customer.id }, data: { password: hashed, tokenVersion: { increment: 1 } }, select: { tokenVersion: true } })
    await tx.biometricToken.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } })
    return c
  })
  await clearLoginThrottle({ phone: customer.phone }).catch(() => {})

  const name = `${customer.firstName} ${customer.lastName}`
  logAudit({
    action: 'customer_password_change',
    entity: 'Customer',
    entityId: customer.id,
    details: `Customer ${name} (${customer.customerId}) changed their password`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: name,
  })

  // Keep this device signed in with a token for the new version.
  const token = await signCustomerToken(
    { id: customer.id, customerId: customer.customerId, name, agentId: customer.agentId, tokenVersion: updated.tokenVersion },
    { loginAt: Math.floor(Date.now() / 1000) },
  )
  const res = NextResponse.json({ ok: true })
  res.cookies.set(customerCookieOptions(token))
  return res
}
