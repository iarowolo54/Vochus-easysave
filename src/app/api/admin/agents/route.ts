import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { validatePhoto } from '@/lib/photo'
import { findIdentityConflict } from '@/lib/identity'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

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
    orderBy: { createdAt: 'desc' },
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
  const guard = await requireSuperAdmin()
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

  const existing = await prisma.agent.findFirst({ where: { OR: [{ phone }, { email }] } })
  if (existing) return NextResponse.json({ error: 'Phone or email already in use' }, { status: 409 })

  const conflict = await findIdentityConflict(prisma, { phone, email })
  if (conflict) {
    return NextResponse.json(
      { error: conflict === 'phone' ? 'This phone number is already registered.' : 'This email is already registered.' },
      { status: 409 },
    )
  }

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

  logAudit({ action: 'agent', entity: 'Agent', entityId: agent.id, details: `Agent created — ${name} (${agentId})`, actorType: 'admin', actorName: 'SuperAdmin' })

  if (email && verifyToken) {
    const verifyUrl = `${process.env.NEXTAUTH_URL}/api/verify-email?token=${verifyToken}`
    sendMail({
      to: email,
      subject: 'Verify your Vochus Easy Save account',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#1a5c35">Verify your email, ${name}</h2>
          <p>An agent account has been created for you on Vochus Easy Save. Click the button below to verify your email and activate your account.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${verifyUrl}" style="background:#1a5c35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Verify Email Address</a>
          </div>
          <div style="background:#f4f9f6;border-radius:8px;padding:16px 20px;margin:16px 0">
            <p style="margin:4px 0;font-size:13px"><strong>Agent ID:</strong> ${agentId}</p>
            <p style="margin:4px 0;font-size:13px"><strong>Phone:</strong> ${phone}</p>
            <p style="margin:4px 0;font-size:13px"><strong>Password:</strong> ${password}</p>
          </div>
          <p style="color:#888;font-size:12px">This link expires once used. Do not share your credentials. If you did not expect this email, ignore it.</p>
        </div>
      `,
    }).catch(() => {})
  }

  return NextResponse.json({ agent: { id: agent.id, agentId: agent.agentId, name: agent.name, emailVerified: agent.emailVerified } }, { status: 201 })
  } catch (err: any) {
    console.error('[agents/create]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
