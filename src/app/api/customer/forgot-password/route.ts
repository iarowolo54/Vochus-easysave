import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { codeEmailMessage } from '@/lib/email-template'
import { sendSMS } from '@/lib/kudisms'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'
import { clientIp } from '@/lib/rate-limit'
import { recoveryChannel } from '@/lib/unlock-otp'

function resetEmail(code: string) {
  return codeEmailMessage({
    subject: 'Vochus Easy Save — Password Reset Code',
    preheader: 'Use this code to choose a new password.',
    heading: 'Reset your password',
    intro: 'Your password reset code is:',
    code,
    caption: 'This code expires in 10 minutes. If you did not request this, ignore this email.',
  })
}

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const phone = text((await readBody(req)).phone)
  if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 })

  // Unknown accounts and accounts in their cooldown get a random resetId, so every answer looks the same.
  let resetId = newResetId()
  try {
    const customer = await prisma.customer.findFirst({ where: { phone, status: { not: 'Converted' } } })
    const issued = customer ? await issueResetCode('customer', customer.id, Date.now(), 'reset', clientIp(req)) : null
    if (customer && issued) {
      resetId = issued.resetId
      const { channel, target } = recoveryChannel(customer)
      deliverInBackground(issued.id, async () => {
        if (channel === 'email') {
          await sendMail({ to: target, ...resetEmail(issued.code) })
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
