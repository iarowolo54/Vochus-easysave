import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'

export async function POST(req: Request) {
  try {
    const { identifier } = await req.json()
    if (!identifier) return NextResponse.json({ error: 'Agent ID or phone required' }, { status: 400 })

    const id = identifier.trim().toLowerCase()
    const agent = await prisma.agent.findFirst({
      where: {
        OR: [
          { agentId: id.toUpperCase() },
          { agentId: id },
          { phone: id },
        ],
      },
    })

    if (!agent) return NextResponse.json({ error: 'No agent found with that ID or phone number' }, { status: 404 })
    if (!agent.lockedAt) return NextResponse.json({ error: 'This account is not locked' }, { status: 400 })

    const token = String(Math.floor(100000 + Math.random() * 900000))
    const expiry = new Date(Date.now() + 15 * 60 * 1000)

    await prisma.agent.update({
      where: { id: agent.id },
      data: { unlockToken: token, unlockTokenExpiry: expiry },
    })

    await sendSMS(
      agent.phone,
      `Vochus Easy Save: Your account unlock code is ${token}. It expires in 15 minutes. Do not share this code.`,
    )

    return NextResponse.json({ ok: true, phone: agent.phone.replace(/(\d{4})\d{3}(\d{4})/, '$1***$2') })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}
