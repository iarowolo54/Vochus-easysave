import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'

// Unauthenticated trust card for the enrol welcome screen: who invited this
// customer. Returns only the agent's first name, their area, and a SMALL
// downscaled photo thumbnail — never the full base64 photo column, and no
// surname/phone/password/other fields. 404 when the invite/agent is unknown.
// Rate-limited per IP because it is public and takes an agent reference.

const THUMB_PX = 96

async function thumbnail(photoUrl: string | null): Promise<string | null> {
  if (!photoUrl) return null
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(photoUrl)
  if (!m) return null
  try {
    const out = await sharp(Buffer.from(m[2], 'base64'))
      .resize(THUMB_PX, THUMB_PX, { fit: 'cover' })
      .webp({ quality: 70 })
      .toBuffer()
    return `data:image/webp;base64,${out.toString('base64')}`
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  const limit = enrolRateLimiter.check(`invite-info:ip:${ip}`, 30, 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const aid = searchParams.get('aid')?.trim()
  const ref = searchParams.get('ref')?.trim()

  // Resolve the agent from an invite token (ref) first, else the agent id (aid).
  let agentDbId: string | null = null
  if (ref) {
    const invite = await prisma.customerInvite.findUnique({ where: { token: ref }, select: { agentId: true } })
    agentDbId = invite?.agentId ?? null
  }
  let agent = agentDbId
    ? await prisma.agent.findUnique({ where: { id: agentDbId }, select: { name: true, location: true, photoUrl: true, status: true } })
    : null
  if (!agent && aid) {
    agent = await prisma.agent.findFirst({ where: { agentId: aid }, select: { name: true, location: true, photoUrl: true, status: true } })
  }

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (agent.status !== 'Active') return NextResponse.json({ error: 'This invite link is no longer active.' }, { status: 410 })

  // Agents have a single `name`; surface only the first word as the first name.
  const firstName = agent.name.trim().split(/\s+/)[0] ?? agent.name

  return NextResponse.json({
    firstName,
    area: agent.location,
    photo: await thumbnail(agent.photoUrl),
  })
}
