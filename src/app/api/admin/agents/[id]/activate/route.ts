import { emailAction } from '@/lib/email-brand'
import { emailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requirePermission('agents', 'manage')
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
    sendMail({
      to: agent.email,
      ...emailMessage({
        subject: 'Your Vochus Easy Save Agent account is now active!',
        preheader: 'You can now sign in to the agent portal.',
        tone: 'success',
        statusLabel: '',
        audience: 'agent',
        heading: `Your account is active, ${agent.name}`,
        intro: 'Your Vochus Easy Save agent account has been reviewed and activated. You can now sign in to the agent portal.',
        action: emailAction('Sign in', '/login'),
        rows: [['Agent ID', agent.agentId], ['Sign in with', 'Your registered phone number and password']],
        note: 'Welcome to the Vochus Easy Save team!',
      }),
    }).catch(() => {})
  }

  return NextResponse.json({ agent: { id: updated.id, agentId: updated.agentId, status: updated.status } })
}
