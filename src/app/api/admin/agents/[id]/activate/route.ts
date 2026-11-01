import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const agent = await prisma.agent.findUnique({ where: { id } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.status !== 'PendingActivation') return NextResponse.json({ error: 'Agent is not pending activation' }, { status: 409 })

  const { floatLimit, region, notes, requiredDocs } = await req.json()
  if (!floatLimit) return NextResponse.json({ error: 'Float limit is required' }, { status: 400 })
  const parsedFloatLimit = parseFloat(floatLimit)
  if (!isFinite(parsedFloatLimit) || parsedFloatLimit < 0) {
    return NextResponse.json({ error: 'Float limit cannot be negative' }, { status: 400 })
  }

  const updated = await prisma.agent.update({
    where: { id },
    data: {
      status: 'Active',
      floatLimit: parsedFloatLimit,
      location: region || agent.location,
      ...(requiredDocs ? { requiredDocs: JSON.stringify(requiredDocs) } : {}),
    },
  })

  logAudit({
    action: 'agent_activate', entity: 'Agent', entityId: agent.id,
    details: `Agent activated — ${agent.name} (${agent.agentId})${notes ? '. Notes: ' + notes : ''}`,
    actorType: guard.actor.type, actorId: guard.actor.id, actorName: guard.actor.name,
  })

  if (agent.email) {
    const loginUrl = `${process.env.NEXTAUTH_URL ?? 'https://easysave.vochusglobalservices.co.uk'}/login`
    sendMail({
      to: agent.email,
      subject: 'Your Vochus Easy Save Agent account is now active!',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1a5c35">Account Activated 🎉</h2>
          <p>Hi ${agent.name},</p>
          <p>Your Vochus Easy Save agent account has been reviewed and activated. You can now log in to the agent portal.</p>
          <div style="background:#f4f9f6;border-radius:8px;padding:16px 20px;margin:16px 0">
            <p style="margin:4px 0;font-size:13px"><strong>Agent ID:</strong> ${agent.agentId}</p>
            <p style="margin:4px 0;font-size:13px"><strong>Login:</strong> Use your registered phone number and password</p>
          </div>
          <a href="${loginUrl}" style="display:inline-block;margin:8px 0 16px;padding:12px 28px;background:#1a5c35;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Log In to Agent Portal →</a>
          <p style="color:#888;font-size:12px">Or copy this link: <a href="${loginUrl}" style="color:#1a5c35">${loginUrl}</a></p>
          <p style="color:#888;font-size:12px">Welcome to the Vochus Easy Save team!</p>
        </div>
      `,
    }).catch(() => {})
  }

  return NextResponse.json({ agent: { id: updated.id, agentId: updated.agentId, status: updated.status } })
}
