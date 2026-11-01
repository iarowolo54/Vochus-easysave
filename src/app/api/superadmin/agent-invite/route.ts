import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const existing = await prisma.agent.findFirst({ where: { email } })
  if (existing) return NextResponse.json({ error: 'An agent with this email already exists' }, { status: 409 })

  const existingInvite = await prisma.agentInvite.findFirst({
    where: { email, status: 'Pending', expiresAt: { gte: new Date() } },
  })
  if (existingInvite) {
    const link = `${process.env.NEXTAUTH_URL}/agent/onboard/${existingInvite.token}`
    sendMail({
      to: email,
      subject: 'You\'ve been invited to join Vochus Easy Save as an Agent',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1a5c35">Agent Onboarding Invitation</h2>
          <p>You have been invited to become an agent on <strong>Vochus Easy Save</strong>. Click the button below to complete your registration.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${link}" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Complete Registration →</a>
          </div>
          <p style="color:#888;font-size:12px">This link expires in 7 days. If you did not expect this invitation, please ignore this email.</p>
        </div>
      `,
    }).catch(() => {})
    logAudit({
      action: 'agent_invite',
      entity: 'AgentInvite',
      entityId: existingInvite.id,
      details: `Resent existing agent invite to ${email}`,
      actorType: 'admin',
      actorName: 'SuperAdmin',
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
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  const link = `${process.env.NEXTAUTH_URL}/agent/onboard/${token}`

  sendMail({
    to: email,
    subject: 'You\'ve been invited to join Vochus Easy Save as an Agent',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#1a5c35">Agent Onboarding Invitation</h2>
        <p>You have been invited to become an agent on <strong>Vochus Easy Save</strong>. Click the button below to complete your registration.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Complete Registration →</a>
        </div>
        <p style="color:#888;font-size:12px">This link expires in 7 days. If you did not expect this invitation, please ignore this email.</p>
      </div>
    `,
  }).catch(() => {})

  return NextResponse.json({ token, link })
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const invites = await prisma.agentInvite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({ invites })
}
