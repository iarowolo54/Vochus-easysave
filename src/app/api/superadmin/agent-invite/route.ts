import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { emailMessage } from '@/lib/email-template'

const inviteEmail = (link: string) => emailMessage({
  subject: 'You\'ve been invited to join Vochus Easy Save as an Agent',
  preheader: 'Finish your registration to start as an agent.',
  tone: 'success',
  statusLabel: '',
  audience: 'agent',
  heading: 'Join Vochus Easy Save as an agent',
  intro: 'You have been invited to become an agent on Vochus Easy Save. Use the button below to complete your registration.',
  action: { label: 'Complete registration', url: link },
  rows: [],
  note: 'This link expires in 7 days. If you did not expect this invitation, please ignore this email.',
})

export async function POST(req: NextRequest) {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { email } = await req.json()
  if (!email || typeof email !== 'string') return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const existing = await prisma.agent.findFirst({ where: { email } })
  if (existing) return NextResponse.json({ error: 'An agent with this email already exists' }, { status: 409 })

  const existingInvite = await prisma.agentInvite.findFirst({
    where: { email, status: 'Pending', expiresAt: { gte: new Date() } },
  })
  if (existingInvite) {
    const link = `${process.env.NEXTAUTH_URL}/agent/onboard/${existingInvite.token}`
    sendMail({
      to: email,
      ...inviteEmail(link),
    }).catch(() => {})
    logAudit({
      action: 'agent_invite',
      entity: 'AgentInvite',
      entityId: existingInvite.id,
      details: `Resent existing agent invite to ${email}`,
      actorType: guard.actor.type,
      actorId: guard.actor.id,
    actorName: guard.actor.name,
    })

    return NextResponse.json({ token: existingInvite.token, link, reused: true })
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const invite = await prisma.agentInvite.create({ data: { token, email, expiresAt } })

  logAudit({
    action: 'agent_invite',
    entity: 'AgentInvite',
    entityId: invite.id,
    details: `New agent invite created for ${email}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  const link = `${process.env.NEXTAUTH_URL}/agent/onboard/${token}`

  sendMail({
    to: email,
    ...inviteEmail(link),
  }).catch(() => {})

  return NextResponse.json({ token, link })
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const invites = await prisma.agentInvite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ invites })
}
