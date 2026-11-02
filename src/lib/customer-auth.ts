import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { requireEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { IDLE_SECONDS, isPastAbsoluteCap } from '@/lib/session-policy'

const SECRET = new TextEncoder().encode(requireEnv('NEXTAUTH_SECRET'))
const COOKIE = 'customer_token'
// The idle window is the single source of truth (no magic numbers). The jose
// token's own exp now enforces idle, matching the cookie maxAge below.
const EXPIRY_SECONDS = IDLE_SECONDS.customer

export interface CustomerSession {
  id: string
  customerId: string
  name: string
  agentId: string
  /** Must match Customer.tokenVersion. A token without it counts as version 0. */
  tokenVersion?: number
}

export interface SignCustomerTokenOptions {
  /** Stable login anchor (epoch seconds) for the absolute cap; persisted into the token. */
  loginAt?: number
  /** Token lifetime in seconds from now; defaults to the customer idle window. */
  expSeconds?: number
}

export async function signCustomerToken(
  payload: CustomerSession,
  opts?: SignCustomerTokenOptions,
): Promise<string> {
  const expSeconds = opts?.expSeconds ?? EXPIRY_SECONDS
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    ...payload,
    ...(opts?.loginAt != null ? { loginAt: opts.loginAt } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expSeconds)
    .sign(SECRET)
}

export async function verifyCustomerToken(token: string): Promise<CustomerSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    // Defense-in-depth absolute cap (the proxy enforces it too): a finite
    // loginAt past the cap is invalid. Missing loginAt (legacy) is not rejected.
    const loginAt = payload.loginAt
    if (typeof loginAt === 'number' && Number.isFinite(loginAt)) {
      if (isPastAbsoluteCap('customer', loginAt, Math.floor(Date.now() / 1000))) return null
    }
    return payload as unknown as CustomerSession
  } catch {
    return null
  }
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  const session = await verifyCustomerToken(token)
  if (!session) return null
  // A password reset bumps the stored version, which ends every session issued before it.
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { tokenVersion: true } })
  if (!customer || customer.tokenVersion !== (session.tokenVersion ?? 0)) return null
  return session
}

export function customerCookieOptions(token: string) {
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: IDLE_SECONDS.customer,
  }
}
