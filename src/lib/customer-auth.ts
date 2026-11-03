import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { CUSTOMER_COOKIE_NAME, verifyCustomerToken, type CustomerSession } from '@/lib/customer-token'

export * from '@/lib/customer-token'

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const jar = await cookies()
  const token = jar.get(CUSTOMER_COOKIE_NAME)?.value
  if (!token) return null
  const session = await verifyCustomerToken(token)
  if (!session) return null
  // A password reset bumps the stored version, which ends every session issued before it.
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { tokenVersion: true } })
  if (!customer || customer.tokenVersion !== (session.tokenVersion ?? 0)) return null
  return session
}
