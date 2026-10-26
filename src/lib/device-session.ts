import { prisma } from './prisma'

export interface DeviceMeta {
  platform?: string | null
  model?: string | null
  manufacturer?: string | null
  osVersion?: string | null
  appVersion?: string | null
}

/**
 * Upsert a DeviceSession row. Called from customer/agent login routes after
 * successful auth. Silent on failure — never fails a real login.
 */
export async function recordDeviceSession(opts: {
  deviceId: string | null | undefined
  app: string | null | undefined
  agentId?: string | null
  customerId?: string | null
  meta?: DeviceMeta
  ipAddress?: string | null
}) {
  const { deviceId, app } = opts
  if (!deviceId || !app) return
  try {
    const now = new Date()
    await prisma.deviceSession.upsert({
      where: { deviceId_app: { deviceId, app } },
      create: {
        deviceId,
        app,
        agentId: opts.agentId ?? null,
        customerId: opts.customerId ?? null,
        platform: opts.meta?.platform ?? null,
        model: opts.meta?.model ?? null,
        manufacturer: opts.meta?.manufacturer ?? null,
        osVersion: opts.meta?.osVersion ?? null,
        appVersion: opts.meta?.appVersion ?? null,
        ipAddress: opts.ipAddress ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        loginCount: 1,
      },
      update: {
        agentId: opts.agentId ?? undefined,
        customerId: opts.customerId ?? undefined,
        platform: opts.meta?.platform ?? undefined,
        model: opts.meta?.model ?? undefined,
        manufacturer: opts.meta?.manufacturer ?? undefined,
        osVersion: opts.meta?.osVersion ?? undefined,
        appVersion: opts.meta?.appVersion ?? undefined,
        ipAddress: opts.ipAddress ?? undefined,
        lastSeenAt: now,
        loginCount: { increment: 1 },
      },
    })
  } catch {
    /* swallow — don't block login on telemetry write */
  }
}
