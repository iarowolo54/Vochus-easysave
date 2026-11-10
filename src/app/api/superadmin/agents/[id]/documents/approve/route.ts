import { emailAction } from '@/lib/email-brand'
import { emailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const { docType, action, reason } = await req.json()
  if (!docType || !action) {
    return NextResponse.json({ error: 'docType and action required' }, { status: 400 })
  }

  const document = await prisma.agentDocument.findUnique({
    where: { agentId_docType: { agentId: id, docType } },
    include: { agent: { select: { name: true, email: true } } },
  })

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (action === 'approve') {
    await prisma.agentDocument.update({
      where: { id: document.id },
      data: { docApprovalStatus: 'approved', docApprovedAt: new Date() },
    })

    // Tell the agent (#13 — previously only rejections emailed). If this was the
    // last document, send the stronger "account ready" note.
    if (document.agent.email) {
      const docs = await prisma.agentDocument.findMany({ where: { agentId: id }, select: { docApprovalStatus: true } })
      const allApproved = docs.length > 0 && docs.every(d => d.docApprovalStatus === 'approved')
      sendMail({
        to: document.agent.email,
        ...emailMessage({
          subject: allApproved ? 'Your Vochus Easy Save account is ready' : 'Document Approved',
          preheader: allApproved ? 'All your documents are approved. You can sign in and start working.' : 'One of your documents has been approved.',
          tone: 'success',
          statusLabel: '',
          audience: 'agent',
          routine: true,
          heading: allApproved ? `Your account is ready, ${document.agent.name}` : 'Document approved',
          intro: allApproved
            ? 'All your submitted documents have been approved, so your account is now fully active. You can sign in and start working.'
            : 'We’ll let you know as your remaining documents are reviewed.',
          action: allApproved ? emailAction('Sign in', '/login') : undefined,
          rows: [['Document', docType]],
        }),
      }).catch(() => {})
    }
  } else if (action === 'reject') {
    if (!reason) {
      return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })
    }
    await prisma.agentDocument.update({
      where: { id: document.id },
      data: { docApprovalStatus: 'rejected', docRejectionReason: reason },
    })

    if (document.agent.email) {
      sendMail({
        to: document.agent.email,
        ...emailMessage({
          subject: 'Document Review – Resubmission Required',
          preheader: 'We need a new copy of one of your documents.',
          tone: 'warning',
          statusLabel: '',
          audience: 'agent',
          heading: 'Please send this document again',
          intro: `Hello ${document.agent.name}, we reviewed your document and need a new copy.`,
          reason: { label: 'What to change', text: reason },
          nextStep: 'Upload an updated copy from your dashboard, and our team will review it again.',
          action: emailAction('Open Vochus Easy Save', '/login'),
          rows: [['Document', docType]],
        }),
      }).catch(() => {})
    }
  }

  logAudit({
    action: action === 'approve' ? 'doc_approve' : 'doc_reject',
    entity: 'AgentDocument',
    entityId: document.id,
    details: action === 'approve'
      ? `Approved ${docType} document for ${document.agent.name}`
      : `Rejected ${docType} document for ${document.agent.name} — ${reason}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
