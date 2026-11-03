// Switches on the new commission model: agents earn the agent savings rate on every deposit, and the
// redemption fee becomes the platform savings rate. Both start at the date stored here, together.
//   npx tsx scripts/commission-go-live.ts           show the current date
//   npx tsx scripts/commission-go-live.ts --now     set it to now (refuses if already set)
//   npx tsx scripts/commission-go-live.ts --now --force   replace an existing date
import { prisma } from '../src/lib/prisma'
import { GO_LIVE_KEY } from '../src/lib/commission-ledger'

async function main() {
  const args = process.argv.slice(2)
  const current = await prisma.platformSetting.findUnique({ where: { key: GO_LIVE_KEY } })
  if (!args.includes('--now')) {
    console.log(current ? `Go-live is set to ${current.value}` : 'Go-live is not set: the new commission model is OFF.')
    return
  }
  if (current && !args.includes('--force')) {
    console.error(`Go-live is already ${current.value}. Pass --force to replace it.`)
    process.exitCode = 1
    return
  }
  const value = new Date().toISOString()
  await prisma.platformSetting.upsert({ where: { key: GO_LIVE_KEY }, update: { value }, create: { key: GO_LIVE_KEY, value } })
  console.log(`Go-live set to ${value}.`)
}

main().finally(() => prisma.$disconnect())
