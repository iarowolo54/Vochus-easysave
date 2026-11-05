import { NextAuthOptions } from 'next-auth'
import { requireEnv } from '@/lib/env'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { isPastAbsoluteCap, IDLE_SECONDS } from '@/lib/session-policy'
import { refundAttempt, reserveAgentAttempt, reserveAttempt } from '@/lib/login-attempt'
import { sendLoginAlert } from '@/lib/login-alert'
import { agentAlertEmailFor } from '@/lib/email-alerts'
import { rightmostForwardedIp } from '@/lib/rate-limit'

const AGENT_IP_FAIL_LIMIT = 20
const AGENT_IP_LOCK_MS = 15 * 60_000

/** The address nginx appended, namespaced apart from customer login's counts. */
export function agentLoginIpKey(xff: string | string[] | null | undefined): string | null {
  const ip = rightmostForwardedIp(xff)
  return ip ? `agent:${ip}` : null
}

const logWriteFailure = (what: string) => (e: unknown) => {
  console.error(`[agent-login] ${what} failed:`, e instanceof Error ? e.message : 'unknown')
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
        // NextAuth accepts JSON bodies, so any of these can arrive as an object: passed to Prisma, { not: '' } is a filter
        // that matches anything. Only a string counts as supplied.
        const field = (name: string) => {
          const value = (credentials as Record<string, unknown> | undefined)?.[name]
          return typeof value === 'string' ? value : undefined
        }
        const identifier = field('identifier')
        const password = field('password')
        const biometricToken = field('biometricToken')
        if (!identifier) return null
        if (!password && !biometricToken) return null

        // Password attempts count against the address before anything else, in the database so it holds across both PM2
        // instances. Fingerprint attempts don't: a token can't be guessed, so a valid one gets through a blocked address
        // and a wrong one isn't a reason to block it. An attempt that can't be counted isn't allowed to try.
        const ipKey = biometricToken ? null : agentLoginIpKey(req?.headers?.['x-forwarded-for'])
        let ipLockStarted = false
        const refundIp = async () => {
          if (ipKey) await refundAttempt(`ip:${ipKey}`, ipLockStarted).catch(logWriteFailure('refund'))
        }
        if (ipKey) {
          try {
            const slot = await reserveAttempt(`ip:${ipKey}`, AGENT_IP_FAIL_LIMIT, [AGENT_IP_LOCK_MS])
            if (!slot.allowed) return null
            ipLockStarted = slot.startedLock
          } catch (e) {
            logWriteFailure('count address')(e)
            return null
          }
        }

        const id = identifier.trim().toLowerCase()

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
            // Only a lock that's still the expired one. In a burst this read can be stale, and clearing unconditionally
            // would wipe a new lock another attempt has just set.
            await prisma.agent.updateMany({
              where: { id: agent.id, lockedAt: { lte: new Date(Date.now() - LOCKOUT_MS) } },
              data: { lockedAt: null, loginAttempts: 0 },
            }).catch(logWriteFailure('auto-unlock'))
            agent.lockedAt = null
            agent.loginAttempts = 0
          } else {
            await refundIp()
            return null
          }
        }

        const deviceId = field('deviceId')

        let valid = false
        // A request with a biometric token is only ever a biometric attempt. Its failures don't lock the account, so
        // falling through to the password here would give unlimited, uncounted guesses.
        if (biometricToken) {
          if (deviceId) {
            const { createHash } = await import('crypto')
            const hash = createHash('sha256').update(biometricToken).digest('hex')
            const t = await prisma.biometricToken.findFirst({
              where: { agentId: agent.id, deviceId, tokenHash: hash, revokedAt: null },
            })
            if (t) {
              valid = true
              await prisma.biometricToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(logWriteFailure('fingerprint last used'))
            }
          }
        } else if (password) {
          let reserved: boolean
          try {
            reserved = await reserveAgentAttempt(agent.id)
          } catch (e) {
            logWriteFailure('count attempt')(e)
            await refundIp()
            return null
          }
          if (!reserved) {
            await refundIp()
            return null
          }
          valid = await bcrypt.compare(password, agent.password)
          if (valid) {
            // The password was right, whatever happens next: this attempt shouldn't build toward a lock.
            await prisma.agent.update({ where: { id: agent.id }, data: { loginAttempts: 0, lockedAt: null } }).catch(logWriteFailure('reset attempts'))
            await refundIp()
          }
        }

        if (!valid) return null

        if (agent.email && !agent.emailVerified) return null

        if (agent.status !== 'Active') return null

        const app = field('app')

        // Device binding only applies to the mobile app. Web browsers can always log in.
        if (app === 'agent') {
          if (agent.boundDeviceId) {
            if (agent.boundDeviceId !== deviceId) return null
          } else if (deviceId) {
            await prisma.agent.update({ where: { id: agent.id }, data: { boundDeviceId: deviceId } }).catch(logWriteFailure('bind device'))
          }
        }

        await prisma.agent.update({
          where: { id: agent.id },
          data: { loginAttempts: 0 },
        }).catch(logWriteFailure('reset attempts'))

        if (app && deviceId) {
          const { recordDeviceSession } = await import('./device-session')
          let meta: Record<string, string | null> | undefined
          const device = field('device')
          try { meta = device ? JSON.parse(device) : undefined } catch { meta = undefined }
          recordDeviceSession({ deviceId, app, agentId: agent.id, meta })
        }

        void sendLoginAlert({ email: agentAlertEmailFor(agent), name: agent.name }, biometricToken ? 'fingerprint' : 'password')

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
