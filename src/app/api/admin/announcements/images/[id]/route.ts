import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { pictureResponse } from '@/lib/announcement-images'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('messages', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const picture = await prisma.announcementImage.findUnique({ where: { id }, select: { mime: true, data: true } })
  if (!picture) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return pictureResponse(picture)
}
