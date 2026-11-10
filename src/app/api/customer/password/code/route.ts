import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { codeEmailMessage } from '@/lib/email-template'
import { sendSMS } from '@/lib/kudisms'
import { getCustomerSession } from '@/lib/customer-auth'
import { checkLoginThrottle, clearLoginThrottle, recordLoginFailure, reserveAccountAttempt, endSessionsIfLocked } from '@/lib/login-attempt'
import { deliverInBackground, issueResetCode, readBody, text } from '@/lib/password-reset'
import { clientIp } from '@/lib/rate-limit'
import { maskTarget, recoveryChannel } from '@/lib/unlock-otp'

function confirmEmail(code: string) {
  return codeEmailMessage({
    subject: 'Vochus Easy Save — Confirm password change',
    preheader: 'Use this code to confirm your new password.',
    heading: 'Confirm password change',
    intro: 'Your confirmation code is:',
    code,
    caption: 'This code expires in 10 minutes. If you did not ask to change your password, do not share this code.',
  })
}

// Step 1 of changing a password: check the current password, then send a code to the
// customer's verified email, or by SMS if they have none. Step 2 is POST /api/customer/password.
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const currentPassword = text((await readBody(req)).currentPassword)
  if (!currentPassword) return NextResponse.json({ error: 'Current password is required' }, { status: 400 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer?.password) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  // Same gate as sign-in: a customer an administrator has locked can't change credentials.
  if (customer.status && customer.status.toLowerCase() !== 'active') {
    return NextResponse.json({ error: 'Your account has been locked by the administrator. Please contact support.' }, { status: 403 })
  }

  const ip = clientIp(req)
  const lockedResponse = () => NextResponse.json({ error: 'Your account is locked after too many wrong attempts. Unlock it with a verification code.', locked: true }, { status: 423 })
  if (ip !== 'unknown') {
    const spray = await checkLoginThrottle({ ip })
    if (spray.blocked) {
      return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, spray.retryAfterSeconds)) } })
    }
  }
  // The attempt is counted before the password is checked, so parallel guesses can't outrun the lock.
  if (!(await reserveAccountAttempt(customer.phone))) return lockedResponse()
  if (!(await bcrypt.compare(currentPassword, customer.password))) {
    if (ip !== 'unknown') await recordLoginFailure({ ip })
    await endSessionsIfLocked(customer.phone)
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }
  await clearLoginThrottle({ phone: customer.phone })

  const issued = await issueResetCode('customer', customer.id, Date.now(), 'password_change', ip)
  if (!issued) {
    return NextResponse.json({ error: 'A code was sent a moment ago. Wait a minute, then try again.' }, { status: 429 })
  }

  const { channel, target } = recoveryChannel(customer)
  deliverInBackground(issued.id, async () => {
    if (channel === 'email') {
      await sendMail({ to: target, ...confirmEmail(issued.code) })
      return true
    }
    // sms: account recovery code, only when there is no confirmed email
    const sms = await sendSMS(target, `Your Vochus Easy Save password change code is ${issued.code}. Valid for 10 minutes. Do not share.`)
    return sms.success
  })

  return NextResponse.json({ sent: true, resetId: issued.resetId, channel, sentTo: maskTarget(channel, target) })
}
