import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { validatePhoto } from '@/lib/photo'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  if (invite.status === 'Completed') return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: 'This invite link has expired' }, { status: 410 })
  return NextResponse.json({ email: invite.email })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  if (invite.status === 'Completed') return NextResponse.json({ error: 'Already completed' }, { status: 410 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: 'Invite expired' }, { status: 410 })

  const body = await req.json()
  const { firstName, lastName, phone, dob, gender, state, lga, address, bvn, nin, nokName, nokPhone, photoUrl, requiredDocs, password } = body

  if (!firstName || !lastName || !phone || !state || !address || !nokName || !nokPhone || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const photoCheck = validatePhoto(photoUrl)
  if (!photoCheck.ok) return NextResponse.json({ error: photoCheck.error }, { status: 400 })

  const existing = await prisma.agent.findFirst({ where: { OR: [{ phone }, { email: invite.email }] } })
  if (existing) return NextResponse.json({ error: 'Phone or email already registered' }, { status: 409 })

  const hashed = await bcrypt.hash(password, 10)

  // Generate a unique agentId by finding the current max and retrying on conflict
  let agent
  for (let attempt = 0; attempt < 5; attempt++) {
    const allAgents = await prisma.agent.findMany({ select: { agentId: true } })
    const maxNum = allAgents.reduce((max, a) => {
      const n = parseInt(a.agentId.replace('AGT-', ''), 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)
    const nextNum = maxNum + 1 + attempt
    const agentId = `AGT-${String(nextNum).padStart(5, '0')}`
    try {
      agent = await prisma.agent.create({
        data: {
          agentId,
          name: `${firstName} ${lastName}`.trim(),
          phone, email: invite.email,
          location: `${state}${lga ? ', ' + lga : ''}`,
          address, dob: dob || null, gender: gender || null,
          bvn: bvn || null, nin: nin || null,
          nokName, nokPhone,
          photoUrl: photoUrl || null,
          requiredDocs: JSON.stringify(Array.isArray(requiredDocs) ? requiredDocs : []),
          password: hashed,
          status: 'PendingActivation',
          emailVerified: true,
          walletBalance: 0,
        },
      })
      break
    } catch (e: any) {
      if (e?.code === 'P2002' && attempt < 4) continue
      throw e
    }
  }
  if (!agent) return NextResponse.json({ error: 'Failed to generate agent ID, please try again' }, { status: 500 })

  await prisma.agentInvite.update({
    where: { token },
    data: { status: 'Completed' },
  })

  logAudit({
    action: 'agent_registered',
    entity: 'Agent',
    entityId: agent.id,
    details: `New agent registered: ${agent.name} (${agent.agentId}) via invite`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ agentId: agent.agentId, name: agent.name })
}
