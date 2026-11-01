import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requirePermission('agents')
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
    subject: 'Verify your Vochus Easy Save account',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#1a5c35">Verify your email, ${agent.name}</h2>
        <p>Click the button below to verify your email and activate your Vochus Easy Save agent account.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${verifyUrl}" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Verify Email Address</a>
        </div>
        <p style="color:#888;font-size:12px">If you did not expect this email, ignore it.</p>
      </div>
    `,
  })

  logAudit({
    action: 'agent_resend_verification',
    entity: 'Agent',
    entityId: agent.id,
    details: `Resent verification email to ${agent.name} (${agent.agentId}) — ${agent.email}`,
    actorType: 'admin',
    ...adminActor(session),
  })

  return NextResponse.json({ ok: true })
}
