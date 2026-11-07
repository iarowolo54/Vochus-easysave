import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import { emailLogo } from '@/lib/email-brand'
import { agentRecoveryChannel } from '@/lib/unlock-otp'
import { clientIp } from '@/lib/rate-limit'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'

function unlockEmailHtml(code: string) {
  return `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
        <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
          <div style="text-align:center;margin-bottom:20px">
            ${emailLogo()}
            <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Unlock Your Account</div>
          </div>
          <p style="font-size:14px;color:#444;margin:0 0 16px">Your account was locked after too many wrong passwords. Your unlock code is:</p>
          <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#0e4d24;margin-bottom:16px;font-family:monospace">
            ${code}
          </div>
          <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. Never share it. If this wasn’t you, change your password after unlocking.</p>
        </div>
      </div>
    `
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
          await sendMail({ to: target, subject: 'Vochus Easy Save — Agent account unlock code', html: unlockEmailHtml(issued.code) })
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
