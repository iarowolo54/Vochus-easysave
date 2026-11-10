import { emailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { validatePhoto } from '@/lib/photo'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('agents', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  // Optional: only the N agents with the most customers (the overview). No top = full list, newest first.
  const topRaw = searchParams.get('top') ?? ''
  const top = /^\d+$/.test(topRaw) && Number(topRaw) > 0 ? Math.min(Number(topRaw), 50) : undefined

  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const agents = await prisma.agent.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search } },
            { agentId: { contains: search } },
            { location: { contains: search } },
          ],
        }
      : undefined,
    include: {
      customers: { select: { id: true } },
      commissions: { where: { month, year }, select: { amount: true } },
      documents: { select: { docType: true, fileName: true, docApprovalStatus: true } },
    },
    orderBy: top ? { customers: { _count: 'desc' } } : { createdAt: 'desc' },
    ...(top && { take: top }),
  })

  return NextResponse.json({
    agents: agents.map(a => {
      let docStatus = null
      if (a.documents.some(d => d.docApprovalStatus === 'rejected')) {
        docStatus = 'rejected'
      } else if (a.documents.some(d => d.docApprovalStatus === 'pending')) {
        docStatus = 'pending_approval'
      }
      return {
        id: a.id,
        agentId: a.agentId,
        name: a.name,
        location: a.location,
        phone: a.phone,
        email: a.email,
        photoUrl: a.photoUrl,
        emailVerified: a.emailVerified,
        walletBalance: a.walletBalance,
        status: a.status,
        lockedAt: a.lockedAt,
        createdAt: a.createdAt,
        customerCount: a.customers.length,
        commission: a.commissions.reduce((s, c) => s + c.amount, 0),
        profileUnlocked: a.profileUnlocked,
        docStatus,
        documents: a.documents,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
  const guard = await requirePermission('agents', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { name, phone, email, location, password, dob, gender, bvn, nin, nokName, nokPhone, address, photoUrl, floatLimit, status: reqStatus, requiredDocs } = await req.json()
  if (!name || !phone || !email || !location || !password || !nokName || !nokPhone) {
    return NextResponse.json({ error: 'Name, phone, email, next of kin name/phone and password are required' }, { status: 400 })
  }
  const photoCheck = validatePhoto(photoUrl)
  if (!photoCheck.ok) return NextResponse.json({ error: photoCheck.error }, { status: 400 })
  if (floatLimit !== undefined && floatLimit !== null && floatLimit !== '') {
    const fl = parseFloat(floatLimit)
    if (!isFinite(fl) || fl < 0) {
      return NextResponse.json({ error: 'Float limit cannot be negative' }, { status: 400 })
    }
  }

  const conflict = await findIdentityConflict(prisma, { phone, email })
  if (conflict) return identityConflictResponse(conflict)

  const count = await prisma.agent.count()
  const agentId = `AGT-${String(count + 1).padStart(5, '0')}`
  const hashed = await bcrypt.hash(password, 10)
  const verifyToken = email ? randomBytes(32).toString('hex') : null

  const agent = await prisma.agent.create({
    data: {
      agentId, name, phone, email: email || null, location,
      address: address || null, dob: dob || null, gender: gender || null,
      bvn: bvn || null, nin: nin || null, nokName: nokName || null, nokPhone: nokPhone || null,
      photoUrl: photoUrl || null,
      floatLimit: floatLimit ? parseFloat(floatLimit) : null,
      requiredDocs: JSON.stringify(Array.isArray(requiredDocs) ? requiredDocs : []),
      password: hashed, walletBalance: 0, status: reqStatus || 'Active',
      emailVerified: !email,
      emailVerifyToken: verifyToken,
    },
  })

  logAudit({ action: 'agent', entity: 'Agent', entityId: agent.id, details: `Agent created — ${name} (${agentId})`, actorType: guard.actor.type, actorId: guard.actor.id, actorName: guard.actor.name })

  if (email && verifyToken) {
    const verifyUrl = `${process.env.NEXTAUTH_URL}/api/verify-email?token=${verifyToken}`
    sendMail({
      to: email,
      ...emailMessage({
        subject: 'Verify your Vochus Easy Save account',
        preheader: 'Verify your email to activate your agent account.',
        tone: 'success',
        statusLabel: '',
        audience: 'agent',
        heading: `Verify your email, ${name}`,
        intro: 'An agent account has been created for you on Vochus Easy Save. Use the button below to verify your email and activate your account.',
        action: { label: 'Verify email address', url: verifyUrl },
        rows: [['Agent ID', agentId], ['Phone', phone], ['Password', password]],
        note: 'This link works once. Do not share your login details. If you did not expect this email, ignore it.',
      }),
    }).catch(() => {})
  }

  return NextResponse.json({ agent: { id: agent.id, agentId: agent.agentId, name: agent.name, emailVerified: agent.emailVerified } }, { status: 201 })
  } catch (err: any) {
    console.error('[agents/create]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
