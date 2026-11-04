import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

// Serves a customer's photo as an image so the list can lazy-load it, instead of
// sending every base64 photo inside the customers JSON.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customers', 'view')
  if (!guard.ok) return guard.response

  const { id } = await params
  const row = await prisma.customer.findUnique({ where: { id }, select: { photoUrl: true } })
  const m = row?.photoUrl?.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m) return new NextResponse(null, { status: 404 })

  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  })
}
