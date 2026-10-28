// One-time, idempotent migration: hash existing plaintext EarlyRedemption
// tokens at rest so in-flight redemptions keep working after the hash-at-rest
// change ships. A stored value already 64-hex is treated as hashed and skipped,
// so this is safe to run more than once and in any environment.
//
//   npx tsx scripts/migrate-redemption-token-hash.ts
import { createHash } from 'node:crypto'
import { prisma } from '../src/lib/prisma'

const isHashed = (s: string) => /^[0-9a-f]{64}$/.test(s)
const sha256 = (s: string) => createHash('sha256').update(String(s).trim()).digest('hex')

async function main() {
  const rows = await prisma.earlyRedemption.findMany({
    where: { token: { not: null } },
    select: { id: true, token: true },
  })

  let migrated = 0
  let skipped = 0
  for (const r of rows) {
    const t = r.token as string
    if (isHashed(t)) { skipped++; continue }
    await prisma.earlyRedemption.update({ where: { id: r.id }, data: { token: sha256(t) } })
    migrated++
  }

  console.log(`redemption token hash migration: ${migrated} hashed, ${skipped} already hashed, ${rows.length} with a token total`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
