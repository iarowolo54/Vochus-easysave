import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { validatePhoto } from '@/lib/photo'
import { asCustomerType } from '@/lib/customer-type'
import { customerPhotoInfo } from '@/lib/customer-photo-request'

/** Just the photo-deadline state, for the reminder pop-up and the Ajo screen: much lighter than /api/customer/me. */
export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Only the photo's presence is used; customerPhotoInfo never returns it.
  const c = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, type: true, photoUrl: true, agent: { select: { name: true } } } })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ photo: await customerPhotoInfo(prisma, c) }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * An online customer adds their own photo, taken live in the app (photo deadline). It goes straight on, with no review.
 * Only when they have none: changing an existing photo, and every offline customer's photo, is their agent's job.
 */
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, type: true, firstName: true, lastName: true, customerId: true, photoUrl: true } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (asCustomerType(customer.type) !== 'online') return NextResponse.json({ error: 'Your agent takes your photo. Please ask them.' }, { status: 403 })
  if (customer.photoUrl) return NextResponse.json({ error: 'You already have a photo. To change it, ask your agent.' }, { status: 403 })

  const body: unknown = await req.json().catch(() => null)
  const photoUrl = body && typeof body === 'object' ? (body as { photoUrl?: unknown }).photoUrl : undefined
  if (typeof photoUrl !== 'string' || !photoUrl) return NextResponse.json({ error: 'Take a photo of your face first.' }, { status: 400 })
  const check = validatePhoto(photoUrl)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  // Conditional, so two quick taps can't both write.
  const done = await prisma.customer.updateMany({ where: { id: customer.id, OR: [{ photoUrl: null }, { photoUrl: '' }] }, data: { photoUrl } })
  if (done.count !== 1) return NextResponse.json({ error: 'You already have a photo. To change it, ask your agent.' }, { status: 403 })
  await prisma.auditLog.create({
    data: { action: 'customer_photo_self_added', entity: 'Customer', entityId: customer.id, actorType: 'customer', actorId: customer.id, actorName: `${customer.firstName} ${customer.lastName}`, details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) added their own photo in the app` },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
