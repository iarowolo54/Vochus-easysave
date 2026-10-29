import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
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
        subject: allApproved ? 'Your Vochus Easy Save account is ready' : 'Document Approved',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#1a5c35">${allApproved ? 'All documents approved 🎉' : 'Document Approved'}</h2>
            <p>Hello ${document.agent.name},</p>
            <div style="background:#f0f8f5;border-left:4px solid #1a5c35;padding:16px;margin:16px 0">
              <p style="margin:0;color:#666"><strong>Document Type:</strong> ${docType}</p>
              <p style="margin:8px 0 0;color:#1a5c35"><strong>Status:</strong> Approved</p>
            </div>
            <p>${allApproved
              ? 'All your submitted documents have been approved — your account is now fully active. You can sign in and start working.'
              : 'This document has been approved. We’ll let you know as your remaining documents are reviewed.'}</p>
            <p style="color:#888;font-size:12px;margin-top:24px">Vochus Easy Save Team</p>
          </div>
        `,
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
        subject: 'Document Review – Resubmission Required',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#d32f2f">Document Rejected</h2>
            <p>Hello ${document.agent.name},</p>
            <p>Your submitted document has been reviewed and requires resubmission:</p>
            <div style="background:#fff3e0;border-left:4px solid #f57c00;padding:16px;margin:16px 0">
              <p style="margin:0;color:#666"><strong>Document Type:</strong> ${docType}</p>
              <p style="margin:8px 0 0;color:#d32f2f"><strong>Feedback:</strong> ${reason}</p>
            </div>
            <p>Please review the feedback and resubmit an updated document through your dashboard. Once resubmitted, our team will review it again.</p>
            <p style="color:#888;font-size:12px;margin-top:24px">Vochus Easy Save Team</p>
          </div>
        `,
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
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ ok: true })
}
