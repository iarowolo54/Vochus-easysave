import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { codeEmailMessage } from '@/lib/email-template'
import { clientIp } from '@/lib/rate-limit'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'

function resetEmail(code: string) {
  return codeEmailMessage({
    subject: 'Vochus Easy Save — Agent Password Reset Code',
    preheader: 'Use this code to choose a new password.',
    heading: 'Reset your password',
    intro: 'Your password reset code is:',
    code,
    caption: 'This code expires in 10 minutes. If you did not request this, ignore this email.',
    audience: 'agent',
  })
}

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const id = text((await readBody(req)).identifier)
  if (!id) return NextResponse.json({ error: 'Agent ID or phone required' }, { status: 400 })

  // Unknown accounts, accounts with no email and accounts in their cooldown get a random resetId, so every answer looks the same.
  let resetId = newResetId()
  try {
    const agent = await prisma.agent.findFirst({
      where: {
        OR: [
          { agentId: id.toUpperCase() },
          { agentId: id },
          { phone: id },
        ],
      },
    })
    const email = agent?.email
    const issued = agent && email ? await issueResetCode('agent', agent.id, Date.now(), 'reset', clientIp(req)) : null
    if (email && issued) {
      resetId = issued.resetId
      deliverInBackground(issued.id, async () => {
        await sendMail({ to: email, ...resetEmail(issued.code) })
        return true
      })
    }
  } catch {
    console.error('Password reset request failed')
  }

  return NextResponse.json({ sent: true, resetId })
}
