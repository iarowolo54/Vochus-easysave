import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { isPhoneLocked } from '@/lib/login-attempt'
import { CUSTOMER_COOKIE_NAME, verifyCustomerToken, type CustomerSession } from '@/lib/customer-token'

export * from '@/lib/customer-token'

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const jar = await cookies()
  const token = jar.get(CUSTOMER_COOKIE_NAME)?.value
  if (!token) return null
  const session = await verifyCustomerToken(token)
  if (!session) return null
  // A password reset bumps the stored version, which ends every session issued before it.
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { tokenVersion: true, status: true, phone: true } })
  if (!customer || customer.tokenVersion !== (session.tokenVersion ?? 0)) return null
  // A locked account has no access at all, even from a session opened before the lock: locked by an administrator
  // (status) or by too many wrong passwords (cleared only by an unlock code or an administrator).
  if (customer.status && customer.status.toLowerCase() !== 'active') return null
  if (await isPhoneLocked(customer.phone)) return null
  return session
}
