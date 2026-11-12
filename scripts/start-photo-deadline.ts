// Starts the 3-day customer photo clock (docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md).
// Run once, after the deploy that ships the feature:   npx tsx scripts/start-photo-deadline.ts [--dry-run]
// Writes the deadline only if none is set, so running it again changes nothing.
import { PrismaClient } from '@prisma/client'
import { PHOTO_DEADLINE_KEY, deadlineFromGoLive, lastSaveDay } from '../src/lib/photo-deadline'

const prisma = new PrismaClient()

async function main() {
  const dry = process.argv.includes('--dry-run')
  const existing = await prisma.platformSetting.findUnique({ where: { key: PHOTO_DEADLINE_KEY } })
  const deadline = existing ? new Date(existing.value) : deadlineFromGoLive(new Date())
  const missing = await prisma.customer.count({ where: { status: 'Active', OR: [{ photoUrl: null }, { photoUrl: '' }] } })
  if (!existing && !dry) await prisma.platformSetting.create({ data: { key: PHOTO_DEADLINE_KEY, value: deadline.toISOString() } })
  const wat = deadline.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short' })
  console.log(`${existing ? 'Already set' : dry ? 'Would set' : 'Set'}: saving pauses from ${wat} (Lagos time). Last day to save without a photo: ${lastSaveDay(deadline)}.`)
  console.log(`Active customers with no photo right now: ${missing}`)
}
main().finally(() => prisma.$disconnect())
