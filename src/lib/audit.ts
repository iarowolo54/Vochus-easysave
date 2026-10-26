import { prisma } from './prisma'

export async function logAudit({
  action, entity, entityId, details, actorType, actorId, actorName
}: {
  action: string; entity: string; entityId?: string; details?: string;
  actorType?: string; actorId?: string; actorName?: string
}) {
  await prisma.auditLog.create({
    data: { action, entity, entityId, details, actorType: actorType ?? 'agent', actorId, actorName }
  }).catch(() => {})
}
