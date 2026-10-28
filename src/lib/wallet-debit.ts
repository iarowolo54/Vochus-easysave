// Atomic balance debits (finding #4). A conditional updateMany guarded by the
// balance decrements only if funds are still sufficient AT WRITE TIME, so two
// concurrent requests on the 2-instance PM2 + SQLite setup can't both pass a
// read-then-write check and overdraw. Returns true iff this call debited.
// Server-only (imports prisma) — keep out of wallet-guard so its pure money()
// stays client-safe.
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export async function debitAgentBalance(
  client: Prisma.TransactionClient | typeof prisma,
  agentId: string,
  field: 'walletBalance' | 'commissionBalance',
  amount: number,
): Promise<boolean> {
  const res =
    field === 'walletBalance'
      ? await client.agent.updateMany({
          where: { id: agentId, walletBalance: { gte: amount } },
          data: { walletBalance: { decrement: amount } },
        })
      : await client.agent.updateMany({
          where: { id: agentId, commissionBalance: { gte: amount } },
          data: { commissionBalance: { decrement: amount } },
        })
  return res.count === 1
}
