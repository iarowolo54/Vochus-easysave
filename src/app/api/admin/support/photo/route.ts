import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

// The photo of the agent or customer a support chat is with, served as an image so the inbox and the New message search
// can lazy-load it instead of carrying every base64 photo in their JSON. ?agent=<id> or ?customer=<id> (database ids).
// Guarded by the support screen itself, so staff who can chat but can't open the Customers screen still see faces.
export async function GET(req: NextRequest) {
  const guard = await requirePermission('support', 'view')
  if (!guard.ok) return guard.response

  const sp = new URL(req.url).searchParams
  const agentId = sp.get('agent')
  const customerId = sp.get('customer')
  if ((agentId ? 1 : 0) + (customerId ? 1 : 0) !== 1) return new NextResponse(null, { status: 400 })

  const row = agentId
    ? await prisma.agent.findUnique({ where: { id: agentId }, select: { photoUrl: true } })
    : await prisma.customer.findUnique({ where: { id: customerId as string }, select: { photoUrl: true } })
  const m = row?.photoUrl?.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m) return new NextResponse(null, { status: 404 })

  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  })
}
