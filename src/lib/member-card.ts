// Server-authoritative MemberCard serial generation.
//
// The previous scheme generated serials on the client as VES-<batchId><NNNN>
// with a weak Math.random batch id and a sequential 4-digit counter, and the
// API trusted whatever serials the client sent. One leaked serial therefore
// revealed the whole batch (…0001, …0002, …), letting an authenticated agent
// enumerate cards to harvest linked-customer PII or claim unlinked cards.
//
// Serials are now generated here with node:crypto, independently of one another
// (no counter) and with enough entropy that enumeration is infeasible. Batch
// grouping lives in the MemberCard.batchId column, not in the serial string.
import { randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

const hex = (bytes: number) => randomBytes(bytes).toString('hex').toUpperCase()

// VES- plus 12 hex chars (48 bits) — unguessable, still short enough to print.
export const SERIAL_RE = /^VES-[0-9A-F]{12}$/

export function genSerial(): string {
  return `VES-${hex(6)}`
}

export function genBatchId(): string {
  return hex(4) // 8 hex chars
}

// Returns `count` distinct, well-formed serials. Dedups in-process; the
// MemberCard.serial @unique index is the final guard against the (astronomically
// rare) cross-batch collision, which the caller retries on.
export function generateUniqueSerials(count: number): string[] {
  const set = new Set<string>()
  while (set.size < count) set.add(genSerial())
  return [...set]
}

export type NewBatch = { batchName: string; quantity: number; expiryDate: Date }
export type BatchResult = { batchId: string; cards: { id: string; serial: string }[] }

// Generates a server-authoritative batch: a random batchId and `quantity`
// crypto-random serials, persisted together. Retries on the (astronomically
// rare) serial-uniqueness collision with a fresh set rather than inserting a
// partial batch.
export async function createCardBatch(
  client: Pick<PrismaClient, 'memberCard'> | Prisma.TransactionClient,
  { batchName, quantity, expiryDate }: NewBatch,
): Promise<BatchResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const batchId = genBatchId()
    const serials = generateUniqueSerials(quantity)
    try {
      await client.memberCard.createMany({
        data: serials.map((serial) => ({ serial, batchName, batchId, expiryDate, status: 'Unlinked' })),
      })
      const cards = await client.memberCard.findMany({
        where: { batchId },
        select: { id: true, serial: true },
        orderBy: { createdAt: 'asc' },
      })
      return { batchId, cards }
    } catch (e) {
      // P2002 = unique constraint (serial or batchId collided) — retry fresh.
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') continue
      throw e
    }
  }
  throw new Error('Could not generate a unique card batch after several attempts')
}
