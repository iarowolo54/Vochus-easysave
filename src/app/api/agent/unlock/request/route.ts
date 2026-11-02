import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'
import { deliverInBackground, issueResetCode, limitByIp, newResetId, readBody, text } from '@/lib/password-reset'

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
    const issued = agent?.lockedAt ? await issueResetCode('agent', agent.id, Date.now(), 'unlock') : null
    if (agent && issued) {
      resetId = issued.resetId
      deliverInBackground(issued.id, async () => {
        const sms = await sendSMS(agent.phone, `Vochus Easy Save: Your account unlock code is ${issued.code}. It expires in 10 minutes. Do not share this code.`)
        return sms.success
      })
    }
  } catch {
    console.error('Agent unlock request failed')
  }

  return NextResponse.json({ ok: true, resetId })
}
