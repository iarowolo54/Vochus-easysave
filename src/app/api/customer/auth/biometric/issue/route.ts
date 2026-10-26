import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCustomerSession } from '@/lib/customer-auth'
import { randomBytes, createHash } from 'crypto'

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex')
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { deviceId } = await req.json()
  if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 })

  const customer = await prisma.customer.findFirst({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  await prisma.biometricToken.updateMany({
    where: { customerId: customer.id, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  const token = randomBytes(32).toString('hex')
  await prisma.biometricToken.create({
    data: { customerId: customer.id, deviceId, tokenHash: sha256(token) },
  })

  return NextResponse.json({ token, identifier: customer.phone })
}
