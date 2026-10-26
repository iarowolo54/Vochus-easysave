import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
