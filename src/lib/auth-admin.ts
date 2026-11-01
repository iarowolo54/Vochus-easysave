import { NextAuthOptions } from 'next-auth'
import { requireEnv } from '@/lib/env'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { pickIdentity } from '@/lib/admin-identity'
import { isPastAbsoluteCap, IDLE_SECONDS } from '@/lib/session-policy'

export const adminAuthOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'superadmin-credentials',
      name: 'Super Admin',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email.trim().toLowerCase()
        const admin = await prisma.superAdmin.findUnique({ where: { email } })
        // Only consult StaffUser when no SuperAdmin owns this email (never shadowed).
        const staff = admin ? null : await prisma.staffUser.findUnique({ where: { email } })

        const identity = pickIdentity({ superAdmin: admin, staff })
        const hash = identity.kind === 'superadmin' ? admin?.password : identity.kind === 'staff' ? staff?.password : undefined
        if (identity.kind === 'none' || !hash) return null

        const valid = await bcrypt.compare(credentials.password, hash)
        if (!valid) return null

        if (identity.kind === 'staff') {
          await prisma.staffUser.update({ where: { id: identity.id }, data: { lastActiveAt: new Date() } })
          return { id: identity.id!, name: identity.name, email: identity.email, role: 'staff' }
        }

        return { id: identity.id!, name: identity.name, email: identity.email, role: 'superadmin' }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: IDLE_SECONDS.admin },
  cookies: {
    sessionToken: {
      name: 'next-admin-auth.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.email = (user as any).email
        // Anchor the absolute session cap at sign-in (the custom login route
        // stamps this too; this covers the NextAuth [...nextauth] sign-in path).
        token.loginAt = Math.floor(Date.now() / 1000)
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        // Absolute-cap defense-in-depth: the admin session-refresh endpoint is
        // excluded from the proxy, so enforce the cap here too. Finite loginAt
        // only — legacy tokens (no loginAt) are not force-expired.
        if (
          typeof token.loginAt === 'number' &&
          isPastAbsoluteCap('admin', token.loginAt, Math.floor(Date.now() / 1000))
        ) {
          return { ...session, user: undefined } as unknown as typeof session
        }
        ;(session.user as any).id = token.sub
        ;(session.user as any).role = token.role
        ;(session.user as any).email = token.email
      }
      return session
    },
  },
  pages: {
    signIn: '/superadmin/login',
  },
  secret: requireEnv('NEXTAUTH_SECRET'),
}
