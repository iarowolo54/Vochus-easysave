import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { emailLogo } from '@/lib/email-brand'
import { sendSMS } from '@/lib/kudisms'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'
import { clientIp } from '@/lib/rate-limit'
import { recoveryChannel } from '@/lib/unlock-otp'

function resetEmailHtml(code: string) {
  return `
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
      `
}

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const phone = text((await readBody(req)).phone)
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 })

  // Unknown accounts and accounts in their cooldown get a random resetId, so every answer looks the same.
  let resetId = newResetId()
  try {
    const customer = await prisma.customer.findFirst({ where: { phone } })
    const issued = customer ? await issueResetCode('customer', customer.id, Date.now(), 'reset', clientIp(req)) : null
    if (customer && issued) {
      resetId = issued.resetId
      const { channel, target } = recoveryChannel(customer)
      deliverInBackground(issued.id, async () => {
        if (channel === 'email') {
          await sendMail({ to: target, subject: 'Vochus Easy Save — Password Reset Code', html: resetEmailHtml(issued.code) })
          return true
        }
        // sms: account recovery code, only when there is no confirmed email
        const sms = await sendSMS(target, `Your Vochus Easy Save password reset code is ${issued.code}. Valid for 10 minutes. Do not share.`)
        return sms.success
      })
    }
  } catch {
    console.error('Password reset request failed')
  }

  return NextResponse.json({ sent: true, resetId })
}
