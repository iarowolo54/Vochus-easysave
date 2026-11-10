import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import { codeEmailMessage } from '@/lib/email-template'
import { agentRecoveryChannel } from '@/lib/unlock-otp'
import { clientIp } from '@/lib/rate-limit'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'

function unlockEmail(code: string) {
  return codeEmailMessage({
    subject: 'Vochus Easy Save — Agent account unlock code',
    preheader: 'Use this code to unlock your account.',
    heading: 'Unlock your account',
    intro: 'Your account was locked after too many wrong passwords. Your unlock code is:',
    code,
    caption: 'This code expires in 10 minutes. Never share it. If this wasn’t you, change your password after unlocking.',
    audience: 'agent',
  })
}

export async function POST(req: Request) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const id = text((await readBody(req)).identifier).toLowerCase()
  if (!id) return NextResponse.json({ error: 'Agent ID or phone required' }, { status: 400 })

  // Unknown accounts, unlocked accounts and accounts in their cooldown get a random resetId, so every answer looks the same.
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
    const issued = agent?.lockedAt ? await issueResetCode('agent', agent.id, Date.now(), 'unlock', clientIp(req)) : null
    if (agent && issued) {
      resetId = issued.resetId
      const { channel, target } = agentRecoveryChannel(agent)
      deliverInBackground(issued.id, async () => {
        if (channel === 'email') {
          await sendMail({ to: target, ...unlockEmail(issued.code) })
          return true
        }
        // sms: agent unlock code, only when the agent has no confirmed email
        const sms = await sendSMS(target, `Vochus Easy Save: Your account unlock code is ${issued.code}. It expires in 10 minutes. Do not share this code.`)
        return sms.success
      })
    }
  } catch {
    console.error('Agent unlock request failed')
  }

  return NextResponse.json({ ok: true, resetId })
}
