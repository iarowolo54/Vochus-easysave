import { NextAuthOptions } from 'next-auth'
import { requireEnv } from '@/lib/env'
import { isPastAbsoluteCap, IDLE_SECONDS } from '@/lib/session-policy'

export const adminAuthOptions: NextAuthOptions = {
  // Admins sign in only through /api/admin-auth/login, which applies the sign-in limit. This config just reads the session.
  providers: [],
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
