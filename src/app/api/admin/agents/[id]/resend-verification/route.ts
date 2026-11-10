import { emailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const agent = await prisma.agent.findFirst({ where: { id } })
  if (!agent || !agent.email) return NextResponse.json({ error: 'Agent not found or no email' }, { status: 404 })
  if (agent.emailVerified) return NextResponse.json({ error: 'Already verified' }, { status: 400 })

  const token = randomBytes(32).toString('hex')
  await prisma.agent.update({ where: { id: agent.id }, data: { emailVerifyToken: token } })

  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/verify-email?token=${token}`
  await sendMail({
    to: agent.email,
    ...emailMessage({
      subject: 'Verify your Vochus Easy Save account',
      preheader: 'Verify your email to activate your agent account.',
      tone: 'success',
      statusLabel: '',
      audience: 'agent',
      heading: `Verify your email, ${agent.name}`,
      intro: 'Use the button below to verify your email and activate your Vochus Easy Save agent account.',
      action: { label: 'Verify email address', url: verifyUrl },
      rows: [],
      note: 'If you did not expect this email, ignore it.',
    }),
  })

  logAudit({
    action: 'agent_resend_verification',
    entity: 'Agent',
    entityId: agent.id,
    details: `Resent verification email to ${agent.name} (${agent.agentId}) — ${agent.email}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
