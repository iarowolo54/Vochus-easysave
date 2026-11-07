import { prisma } from './prisma'
import { notifications, notify } from './notifications'

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
    const owner = opts.agentId ? { type: 'agent' as const, id: opts.agentId } : opts.customerId ? { type: 'customer' as const, id: opts.customerId } : null
    const ownerWhere = owner?.type === 'agent' ? { agentId: owner.id } : owner ? { customerId: owner.id } : null
    await prisma.$transaction(async tx => {
      // A phone this person hasn't used before, when they already use another one: worth a security notice.
      // Their very first phone (first sign-in after installing) isn't, so it stays quiet.
      const before = await tx.deviceSession.findUnique({ where: { deviceId_app: { deviceId, app } }, select: { agentId: true, customerId: true } })
      const newForOwner = !!owner && !(before && (owner.type === 'agent' ? before.agentId === owner.id : before.customerId === owner.id))
      const hasOtherPhone = newForOwner && ownerWhere ? (await tx.deviceSession.count({ where: { ...ownerWhere, app, NOT: { deviceId } } })) > 0 : false
      // notify: newPhone
      const row = await tx.deviceSession.upsert({
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
      if (owner && hasOtherPhone) {
        await notify(tx, notifications.newPhone({ type: owner.type, id: owner.id, deviceSessionId: `${row.id}:${owner.id}`, model: opts.meta?.model ?? null }))
      }
    })
  } catch {
    /* swallow — don't block login on telemetry write */
  }
}
