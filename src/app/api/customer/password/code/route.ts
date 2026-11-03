import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { emailLogo } from '@/lib/email-brand'
import { sendSMS } from '@/lib/kudisms'
import { getCustomerSession } from '@/lib/customer-auth'
import { checkLoginThrottle, recordLoginFailure } from '@/lib/login-attempt'
import { deliverInBackground, issueResetCode, readBody, text } from '@/lib/password-reset'
import { clientIp } from '@/lib/rate-limit'
import { maskTarget, recoveryChannel } from '@/lib/unlock-otp'

function codeEmailHtml(code: string) {
  return `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
          <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
            <div style="text-align:center;margin-bottom:20px">
              ${emailLogo()}
              <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Confirm password change</div>
            </div>
            <p style="font-size:14px;color:#444;margin:0 0 16px">Your confirmation code is:</p>
            <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#1a6b3a;margin-bottom:16px;font-family:monospace">
              ${code}
            </div>
            <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. If you did not ask to change your password, do not share this code.</p>
          </div>
        </div>
      `
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

  const throttle = await checkLoginThrottle({ phone: customer.phone })
  if (throttle.accountLocked) {
    return NextResponse.json({ error: 'Your account is locked after too many wrong attempts. Unlock it with a verification code.', locked: true }, { status: 423 })
  }
  if (!(await bcrypt.compare(currentPassword, customer.password))) {
    await recordLoginFailure({ phone: customer.phone }).catch(() => {})
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const issued = await issueResetCode('customer', customer.id, Date.now(), 'password_change', clientIp(req))
  if (!issued) {
    return NextResponse.json({ error: 'A code was sent a moment ago. Wait a minute, then try again.' }, { status: 429 })
  }

  const { channel, target } = recoveryChannel(customer)
  deliverInBackground(issued.id, async () => {
    if (channel === 'email') {
      await sendMail({ to: target, subject: 'Vochus Easy Save — Confirm password change', html: codeEmailHtml(issued.code) })
      return true
    }
    const sms = await sendSMS(target, `Your Vochus Easy Save password change code is ${issued.code}. Valid for 10 minutes. Do not share.`)
    return sms.success
  })

  return NextResponse.json({ sent: true, resetId: issued.resetId, channel, sentTo: maskTarget(channel, target) })
}
