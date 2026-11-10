import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { checkPicture, storePicture } from '@/lib/announcement-images'

/** Upload one picture for the message being written. It joins the message when the message is saved. */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('messages', 'manage')
  if (!guard.ok) return guard.response
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a picture.' }, { status: 400 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const checked = checkPicture(bytes)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  return NextResponse.json(await storePicture(prisma, bytes, checked.mime))
}
