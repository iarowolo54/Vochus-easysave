import { NextAuthOptions } from 'next-auth'
import { requireEnv } from '@/lib/env'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Agent ID / Phone', type: 'text' },
        password: { label: 'Password', type: 'password' },
        app: { label: 'App', type: 'text' },
        deviceId: { label: 'Device ID', type: 'text' },
        biometricToken: { label: 'Biometric Token', type: 'text' },
        device: { label: 'Device Meta (JSON)', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.identifier) return null
        const biometricToken = (credentials as any).biometricToken as string | undefined
        if (!credentials.password && !biometricToken) return null

        const id = credentials.identifier.trim().toLowerCase()

        const agent = await prisma.agent.findFirst({
          where: {
            OR: [
              { agentId: id.toUpperCase() },
              { agentId: id },
              { phone: id },
            ],
          },
        })

        if (!agent) return null

        // Auto-unlock after 30 min
        const LOCKOUT_MS = 30 * 60 * 1000
        if (agent.lockedAt) {
          if (Date.now() - new Date(agent.lockedAt).getTime() > LOCKOUT_MS) {
            await prisma.agent.update({
              where: { id: agent.id },
              data: { lockedAt: null, loginAttempts: 0 },
            }).catch(() => {})
            agent.lockedAt = null
            agent.loginAttempts = 0
          } else {
            return null
          }
        }

        const deviceIdForBio = (credentials as any).deviceId as string | undefined

        let valid = false
        if (biometricToken && deviceIdForBio) {
          const { createHash } = await import('crypto')
          const hash = createHash('sha256').update(biometricToken).digest('hex')
          const t = await prisma.biometricToken.findFirst({
            where: { agentId: agent.id, deviceId: deviceIdForBio, tokenHash: hash, revokedAt: null },
          })
          if (t) {
            valid = true
            await prisma.biometricToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
          }
        } else if (credentials.password) {
          valid = await bcrypt.compare(credentials.password, agent.password)
        }

        if (!valid) {
          if (!biometricToken) {
            const newAttempts = agent.loginAttempts + 1
            if (newAttempts >= 3) {
              await prisma.agent.update({
                where: { id: agent.id },
                data: { loginAttempts: newAttempts, lockedAt: new Date() },
              }).catch(() => {})
            } else {
              await prisma.agent.update({
                where: { id: agent.id },
                data: { loginAttempts: newAttempts },
              }).catch(() => {})
            }
          }
          return null
        }

        if (agent.email && !agent.emailVerified) return null

        if (agent.status !== 'Active') return null

        const app = (credentials as any).app
        const deviceId = (credentials as any).deviceId as string | undefined

        // Device binding only applies to the mobile app. Web browsers can always log in.
        if (app === 'agent') {
          if (agent.boundDeviceId) {
            if (agent.boundDeviceId !== deviceId) return null
          } else if (deviceId) {
            await prisma.agent.update({ where: { id: agent.id }, data: { boundDeviceId: deviceId } }).catch(() => {})
          }
        }

        await prisma.agent.update({
          where: { id: agent.id },
          data: { loginAttempts: 0 },
        }).catch(() => {})

        if (app && deviceId) {
          const { recordDeviceSession } = await import('./device-session')
          let meta: Record<string, string | null> | undefined
          try { meta = (credentials as any).device ? JSON.parse((credentials as any).device) : undefined } catch { meta = undefined }
          recordDeviceSession({ deviceId, app, agentId: agent.id, meta })
        }

        return {
          id: agent.id,
          name: agent.name,
          agentId: agent.agentId,
          location: agent.location,
          walletBalance: agent.walletBalance,
          // photoUrl deliberately NOT returned — can be huge base64; session callback loads from DB
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.agentId = (user as any).agentId
        token.location = (user as any).location
        token.walletBalance = (user as any).walletBalance
        // photoUrl intentionally not stored in JWT (cookie size limit)
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).agentId = token.agentId
        ;(session.user as any).location = token.location
        const agent = await prisma.agent.findFirst({
          where: { agentId: token.agentId as string },
          include: { documents: { select: { docType: true, docApprovalStatus: true } } },
        })
        ;(session.user as any).id = agent?.id
        ;(session.user as any).walletBalance = agent?.walletBalance ?? token.walletBalance
        ;(session.user as any).photoUrl = agent?.photoUrl ?? token.photoUrl
        const required = JSON.parse(agent?.requiredDocs ?? '[]') as string[]
        const documents = agent?.documents ?? []
        const uploaded = documents.map(d => d.docType)
        const allUploaded = required.length === 0 || required.every(d => uploaded.includes(d))
        const allApproved = required.length === 0 || required.every(d => documents.find(doc => doc.docType === d)?.docApprovalStatus === 'approved')
        ;(session.user as any).documentsComplete = allUploaded && allApproved
        ;(session.user as any).documentsUploaded = allUploaded
      }
      return session
    },
  },
  pages: {
    signIn: '/',
  },
  secret: requireEnv('NEXTAUTH_SECRET'),
}
