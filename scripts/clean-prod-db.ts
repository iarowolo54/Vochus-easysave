import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Clearing production data (keeping agents, super admin, staff, rates, wallets)...')

  // Order matters — delete children before parents
  const [er]  = await Promise.all([prisma.earlyRedemption.deleteMany()])
  const [mc]  = await Promise.all([prisma.memberCard.deleteMany()])
  const [lr]  = await Promise.all([prisma.loanRepayment.deleteMany()])
  const [lo]  = await Promise.all([prisma.loan.deleteMany()])
  const [tx]  = await Promise.all([prisma.transaction.deleteMany()])
  const [sp]  = await Promise.all([prisma.savingsPlan.deleteMany()])
  const [cm]  = await Promise.all([prisma.commission.deleteMany()])
  const [ir]  = await Promise.all([prisma.issueReport.deleteMany()])
  const [sa]  = await Promise.all([prisma.subAgent.deleteMany()])
  const [ad]  = await Promise.all([prisma.agentDocument.deleteMany()])
  const [cu]  = await Promise.all([prisma.customer.deleteMany()])
  const [otp] = await Promise.all([prisma.phoneOTP.deleteMany()])
  const [al]  = await Promise.all([prisma.auditLog.deleteMany()])

  console.log('Deleted:')
  console.log(`  EarlyRedemptions : ${er.count}`)
  console.log(`  MemberCards      : ${mc.count}`)
  console.log(`  LoanRepayments   : ${lr.count}`)
  console.log(`  Loans            : ${lo.count}`)
  console.log(`  Transactions     : ${tx.count}`)
  console.log(`  SavingsPlans     : ${sp.count}`)
  console.log(`  Commissions      : ${cm.count}`)
  console.log(`  IssueReports     : ${ir.count}`)
  console.log(`  SubAgents        : ${sa.count}`)
  console.log(`  AgentDocuments   : ${ad.count}`)
  console.log(`  Customers        : ${cu.count}`)
  console.log(`  PhoneOTPs        : ${otp.count}`)
  console.log(`  AuditLogs        : ${al.count}`)

  const agents = await prisma.agent.count()
  const admins = await prisma.superAdmin.count()
  const staff  = await prisma.staffUser.count()
  const rates  = await prisma.interestRate.count()
  const wallets = await prisma.platformWallet.count()

  console.log('\nKept:')
  console.log(`  Agents         : ${agents}`)
  console.log(`  SuperAdmins    : ${admins}`)
  console.log(`  StaffUsers     : ${staff}`)
  console.log(`  InterestRates  : ${rates}`)
  console.log(`  PlatformWallets: ${wallets}`)

  console.log('\n✅ Production database cleaned.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
