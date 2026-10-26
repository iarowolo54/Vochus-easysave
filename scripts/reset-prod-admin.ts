import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const agentDel = await prisma.agent.deleteMany()
  console.log('Agents deleted:', agentDel.count)

  const hash = await bcrypt.hash('Vochus@123#!vs', 10)

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
