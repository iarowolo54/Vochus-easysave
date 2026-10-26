import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

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

        const admin = await prisma.superAdmin.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        })

        if (!admin) return null

        const valid = await bcrypt.compare(credentials.password, admin.password)
        if (!valid) return null

        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: 'superadmin',
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: 'next-admin-auth.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.email = (user as any).email
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub
        ;(session.user as any).role = token.role
        ;(session.user as any).email = token.email
      }
      return session
    },
  },
  pages: {
    signIn: '/superadmin/login',
  },
  secret: process.env.NEXTAUTH_SECRET ?? 'vochus-easy-save-secret-dev-2026',
}
