import { NextAuthOptions } from 'next-auth'
import { requireEnv } from '@/lib/env'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { isPastAbsoluteCap, IDLE_SECONDS } from '@/lib/session-policy'
import { checkLoginThrottle, recordLoginFailure } from '@/lib/login-attempt'

/** The address nginx appended (rightmost; the rest is client-supplied), namespaced apart from customer login's counts. */
export function agentLoginIpKey(xff: string | string[] | undefined): string | null {
  const header = Array.isArray(xff) ? xff.join(',') : xff
  const ip = header?.split(',').map(s => s.trim()).filter(Boolean).pop()
  return ip && ip.length <= 45 ? `agent:${ip}` : null
}

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
      async authorize(credentials, req) {
        if (!credentials?.identifier) return null
        const biometricToken = (credentials as any).biometricToken as string | undefined
        if (!credentials.password && !biometricToken) return null

        // Across both PM2 instances, since the count is in the database. A failure of the throttle itself must not
        // take down login: if the database is truly gone, the lookup below fails too.
        const ip = agentLoginIpKey(req?.headers?.['x-forwarded-for'])
        if (ip) {
          const throttle = await checkLoginThrottle({ ip }).catch(() => null)
          if (throttle?.blocked) return null
        }
        const countFailure = async () => { if (ip) await recordLoginFailure({ ip }).catch(() => {}) }

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

        if (!agent) {
          await countFailure()
          return null
        }

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
        // A request with a biometric token is only ever a biometric attempt. Its failures don't lock the account, so
        // falling through to the password here would give unlimited, uncounted guesses.
        if (biometricToken) {
          if (deviceIdForBio) {
            const { createHash } = await import('crypto')
            const hash = createHash('sha256').update(biometricToken).digest('hex')
            const t = await prisma.biometricToken.findFirst({
              where: { agentId: agent.id, deviceId: deviceIdForBio, tokenHash: hash, revokedAt: null },
            })
            if (t) {
              valid = true
              await prisma.biometricToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
            }
          }
        } else if (credentials.password) {
          valid = await bcrypt.compare(credentials.password, agent.password)
        }

        if (!valid) {
          await countFailure()
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
          tokenVersion: agent.tokenVersion,
          // photoUrl deliberately NOT returned — can be huge base64; session callback loads from DB
        }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: IDLE_SECONDS.agent },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Stable login anchor for the absolute cap; only set at sign-in (user is absent on refresh).
        token.loginAt = Math.floor(Date.now() / 1000)
        token.agentId = (user as any).agentId
        token.location = (user as any).location
        token.walletBalance = (user as any).walletBalance
        token.tokenVersion = (user as any).tokenVersion ?? 0
        // photoUrl intentionally not stored in JWT (cookie size limit)
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        // Without an agentId the lookup below would match an arbitrary agent (Prisma ignores undefined).
        if (typeof token.agentId !== 'string' || !token.agentId) {
          return { ...session, user: undefined } as unknown as typeof session
        }
        (session.user as any).agentId = token.agentId
        ;(session.user as any).location = token.location
        const agent = await prisma.agent.findFirst({
          where: { agentId: token.agentId },
          include: { documents: { select: { docType: true, docApprovalStatus: true } } },
        })
        // A JWT outlives the login check, so a suspended or removed agent is cut off here, on their next request.
        if (!agent || agent.status !== 'Active') {
          return { ...session, user: undefined } as unknown as typeof session
        }
        // Revoke tokens issued before the agent's last password change: if the
        // stored tokenVersion has moved on, clear the user so protected routes
        // (which all check session.user) treat this session as logged out.
        if ((agent.tokenVersion ?? 0) !== ((token.tokenVersion as number) ?? 0)) {
          return { ...session, user: undefined } as unknown as typeof session
        }
        // Absolute-cap defense-in-depth: the session-refresh endpoint is excluded
        // from the proxy, so enforce the cap here too. Finite loginAt only —
        // legacy tokens (no loginAt) are not force-expired.
        if (
          typeof token.loginAt === 'number' &&
          isPastAbsoluteCap('agent', token.loginAt, Math.floor(Date.now() / 1000))
        ) {
          return { ...session, user: undefined } as unknown as typeof session
        }
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
    signIn: '/login',
  },
  secret: requireEnv('NEXTAUTH_SECRET'),
}
