import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Reset the super-admin password. The new password must be supplied via the
// ADMIN_RESET_PASSWORD env var (or argv[1]) — never hardcode a secret here.
//   ADMIN_RESET_PASSWORD='…' npx tsx scripts/reset-prod-admin.ts
// Wiping all agents is DANGEROUS and is NOT part of resetting the admin, so it
// only runs when you opt in explicitly:
//   CONFIRM_WIPE_AGENTS=1 ADMIN_RESET_PASSWORD='…' npx tsx scripts/reset-prod-admin.ts
async function main() {
  const newPassword = process.env.ADMIN_RESET_PASSWORD || process.argv[2]
  if (!newPassword) {
    console.error('Refusing to run: set ADMIN_RESET_PASSWORD (or pass the password as the first argument).')
    process.exit(1)
  }

  if (process.env.CONFIRM_WIPE_AGENTS === '1') {
    const agentDel = await prisma.agent.deleteMany()
    console.log('Agents deleted:', agentDel.count)
  }

  const hash = await bcrypt.hash(newPassword, 10)

  // Try updating existing admin (old email), else upsert with new email
  const existing = await prisma.superAdmin.findFirst()
  let admin
  if (existing) {
    admin = await prisma.superAdmin.update({
      where: { id: existing.id },
      data: { email: 'admin@vochusglobalservices.co.uk', password: hash, name: 'Super Admin' },
    })
  } else {
    admin = await prisma.superAdmin.create({
      data: { email: 'admin@vochusglobalservices.co.uk', password: hash, name: 'Super Admin' },
    })
  }

  console.log('Super admin:', admin.email)
  console.log('Done.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
