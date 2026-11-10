import { codeEmailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { sendMail } from '@/lib/mail'
import { sendSMS } from '@/lib/kudisms'
import { cancelResetCode, issueAdminResetCode, readBody, text, type ResetActor } from '@/lib/password-reset'
import { maskTarget, pickChannel, recoveryChannel } from '@/lib/unlock-otp'

// Sends a password reset code to the channel already on file, past the cooldown and daily cap, for
// someone locked out of recovery. The admin never sees the code, and the code's resetId travels in a link.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const body = await readBody(req)
  const actorType = text(body.actorType)
  const id = text(body.id)
  if ((actorType !== 'customer' && actorType !== 'agent') || !id) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const pinCheck = await verifyApprovalPin(guard.session, text(body.pin))
  if (!pinCheck.ok) return pinCheck.response

  const baseUrl = process.env.NEXTAUTH_URL
  if (!baseUrl) return NextResponse.json({ error: 'The code couldn’t be sent. Try again.' }, { status: 500 })

  const type: ResetActor = actorType
  const account = type === 'customer'
    ? await prisma.customer.findUnique({ where: { id }, select: { id: true, email: true, emailVerifiedAt: true, phone: true, firstName: true, lastName: true, customerId: true } })
    : await prisma.agent.findUnique({ where: { id }, select: { id: true, email: true, phone: true, name: true, agentId: true } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const label = 'customerId' in account
    ? `${account.firstName} ${account.lastName} (${account.customerId})`
    : `${account.name} (${account.agentId})`
  const { channel, target } = 'customerId' in account ? recoveryChannel(account) : pickChannel(account)
  const issued = await issueAdminResetCode(type, account.id)
  const path = type === 'customer' ? '/customer/forgot-password' : '/forgot-password'
  const link = `${baseUrl}${path}?r=${issued.resetId}`

  let delivered = false
  try {
    if (channel === 'email') {
      await sendMail({
        to: target,
        ...codeEmailMessage({
          subject: 'Vochus Easy Save — Password Reset Code',
          preheader: 'Use this code to choose a new password.',
          heading: 'Reset your password',
          intro: 'An administrator sent you this password reset code:',
          code: issued.code,
          caption: 'It expires in 10 minutes. Open the link below and enter the code with your new password. Never share this code, including with staff.',
          action: { label: 'Reset password', url: link },
          audience: type,
        }),
      })
      delivered = true
    } else {
      // sms: staff password reset code (staff, not customers)
      const sms = await sendSMS(target, `Vochus Easy Save: your password reset code is ${issued.code}. Open ${link} within 10 minutes to use it. Do not share this code.`)
      delivered = sms.success
    }
  } catch {
    delivered = false
  }

  if (!delivered) {
    await cancelResetCode(issued.id)
    await logAudit({
      action: 'admin_password_reset_code_failed',
      entity: type === 'customer' ? 'Customer' : 'Agent',
      entityId: account.id,
      details: `A password reset code for ${label} could not be sent by ${channel}`,
      actorType: 'admin',
      ...adminActor(guard.session),
    })
    return NextResponse.json({ error: 'The code couldn’t be sent. Try again.' }, { status: 502 })
  }

  await logAudit({
    action: 'admin_password_reset_code_sent',
    entity: type === 'customer' ? 'Customer' : 'Agent',
    entityId: account.id,
    details: `Sent a password reset code to ${label} by ${channel}`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ sent: true, channel, sentTo: maskTarget(channel, target) })
}
