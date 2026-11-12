import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Platform wallets — ensure all exist so update() never fails
  for (const type of ['Capital', 'Float', 'SavingsPool', 'Redemption', 'Revenue']) {
    await prisma.platformWallet.upsert({
      where: { type },
      update: {},
      create: { type, balance: 0 },
    })
  }

  const adminHash = await bcrypt.hash('Vc#Admin2026!', 10)
  const adminPinHash = await bcrypt.hash('4163', 10)
  for (const email of ['admin@vochus.ng', 'admin@vochusglobalservices.co.uk']) {
    await prisma.superAdmin.upsert({
      where: { email },
      update: { approvalPin: adminPinHash },
      create: { email, password: adminHash, name: 'Super Admin', approvalPin: adminPinHash },
    })
  }

  // Platform commission settings
  await prisma.platformSetting.upsert({
    where: { key: 'commissionRates' },
    update: {},
    create: {
      key: 'commissionRates',
      value: JSON.stringify({ agentSavings: 0.4, agentLoan: 1.0, agentRepay: 0.5, platformSavings: 1.6, platformLoan: 5.0, platformPenalty: 2.0 }),
    },
  })

  // Interest rates
  const rates = [
    { durationDays: 30, label: '30 Days', rate: 5 },
    { durationDays: 60, label: '60 Days', rate: 8 },
    { durationDays: 90, label: '90 Days', rate: 12 },
    { durationDays: 180, label: '180 Days', rate: 18 },
  ]
  for (const r of rates) {
    await prisma.interestRate.upsert({
      where: { durationDays: r.durationDays },
      update: { rate: r.rate, label: r.label },
      create: r,
    })
  }

  await prisma.rewardPromo.upsert({
    where: { id: 'promo-default' },
    update: { isActive: true },
    create: {
      id: 'promo-default',
      isActive: true,
      startDate: new Date('2026-09-04'),
      endDate: new Date('2026-12-31'),
      onlineRewardAmount: 200,
      offlineRewardAmount: 500,
    },
  })

  if (process.env.SEED_DEMO_DATA !== '1') {
    console.log('Seed baseline complete (wallets + admins + settings). No agents are created here; set SEED_DEMO_DATA=1 locally for a demo agent and customers.')
    return
  }

  // Demo agent (local demo data only — never created by a production seed)
  const hash = await bcrypt.hash('collo123', 10)

  const agent = await prisma.agent.upsert({
    where: { agentId: 'AGT-00142' },
    update: {},
    create: {
      agentId: 'AGT-00142',
      phone: '08012345678',
      name: 'Adebayo Okafor',
      location: 'Lagos, NG',
      password: hash,
      walletBalance: 184500,
    },
  })

  // Sub-agents
  await prisma.subAgent.upsert({
    where: { phone: '08098765431' },
    update: {},
    create: {
      parentAgentId: agent.id,
      name: 'Kemi Adebisi',
      phone: '08098765431',
      location: 'Yaba, Lagos',
      walletBalance: 20000,
    },
  })
  await prisma.subAgent.upsert({
    where: { phone: '08087654322' },
    update: {},
    create: {
      parentAgentId: agent.id,
      name: 'Musa Lawan',
      phone: '08087654322',
      location: 'Kano',
      walletBalance: 15000,
    },
  })


  // Customers
  const now = new Date('2026-05-17T10:00:00Z')

  const customers = [
    {
      customerId: 'CST-00312',
      firstName: 'Ngozi',
      lastName: 'Eze',
      phone: '08012345678',
      email: 'ngozi.eze@mail.com',
      address: '14 Akin Close, Yaba, Lagos',
      nokName: 'Chukwu Eze',
      nokRelation: 'Spouse',
      nokPhone: '08011112222',
      planDays: 90,
      planDaily: 700,
      planGoal: 'School Fees',
      planBalance: 62000,
      planStartOffset: -60,
      status: 'Active',
    },
    {
      customerId: 'CST-00289',
      firstName: 'Emeka',
      lastName: 'Obi',
      phone: '08023456789',
      email: 'emeka.obi@mail.com',
      address: '5 Bode Thomas, Surulere, Lagos',
      nokName: 'Ada Obi',
      nokRelation: 'Spouse',
      nokPhone: '08022223333',
      planDays: 60,
      planDaily: 750,
      planGoal: 'Business Capital',
      planBalance: 45000,
      planStartOffset: -45,
      status: 'Active',
    },
    {
      customerId: 'CST-00241',
      firstName: 'Fatima',
      lastName: 'Bello',
      phone: '08034567890',
      email: 'fatima.bello@mail.com',
      address: '22 Maiduguri Road, Garki, Abuja',
      nokName: 'Sule Bello',
      nokRelation: 'Parent',
      nokPhone: '08033334444',
      planDays: 90,
      planDaily: 500,
      planGoal: 'House Rent',
      planBalance: 38000,
      planStartOffset: -55,
      status: 'Active',
    },
    {
      customerId: 'CST-00178',
      firstName: 'Grace',
      lastName: 'Adeleke',
      phone: '08045678901',
      email: 'grace.adeleke@mail.com',
      address: '9 Opebi Road, Ikeja, Lagos',
      nokName: 'Tunde Adeleke',
      nokRelation: 'Sibling',
      nokPhone: '08044445555',
      planDays: 180,
      planDaily: 510,
      planGoal: 'Medical Expenses',
      planBalance: 91000,
      planStartOffset: -170,
      planStatus: 'Matured',
      status: 'Active',
    },
    {
      customerId: 'CST-00190',
      firstName: 'Usman',
      lastName: 'Garba',
      phone: '08056789012',
      email: 'usman.garba@mail.com',
      address: '3 Ahmadu Bello Way, Kano',
      nokName: 'Hafsat Garba',
      nokRelation: 'Spouse',
      nokPhone: '08055556666',
      planDays: 90,
      planDaily: 430,
      planGoal: 'Business Capital',
      planBalance: 38500,
      planStartOffset: -80,
      status: 'Active',
    },
    {
      customerId: 'CST-00204',
      firstName: 'Blessing',
      lastName: 'Okoro',
      phone: '08067890123',
      email: 'blessing.okoro@mail.com',
      address: '18 New Haven, Enugu',
      nokName: 'Chidi Okoro',
      nokRelation: 'Sibling',
      nokPhone: '08066667777',
      planDays: 180,
      planDaily: 510,
      planGoal: 'Wedding / Event',
      planBalance: 91000,
      planStartOffset: -160,
      status: 'Active',
    },
  ]

  const createdCustomers: Record<string, { id: string; planId: string }> = {}

  for (const c of customers) {
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() + c.planStartOffset)
    const maturityDate = new Date(startDate)
    maturityDate.setDate(maturityDate.getDate() + c.planDays)

    const cust = await prisma.customer.upsert({
      where: { customerId: c.customerId },
      update: {},
      create: {
        customerId: c.customerId,
        agentId: agent.id,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        address: c.address,
        nokName: c.nokName,
        nokRelation: c.nokRelation,
        nokPhone: c.nokPhone,
        status: c.status,
      },
    })

    // The (customerId, startDate) unique index is gone, so upsert by it no longer
    // works. Find this demo plan by (customer + goal) and update, else create.
    const existingPlan = await prisma.savingsPlan.findFirst({
      where: { customerId: cust.id, goal: c.planGoal },
    })
    const planData = {
      dailyAmount: c.planDaily,
      periodDays: c.planDays,
      goal: c.planGoal,
      maturityDate,
      balance: c.planBalance,
      status: (c as any).planStatus ?? 'Active',
    }
    const plan = existingPlan
      ? await prisma.savingsPlan.update({ where: { id: existingPlan.id }, data: planData })
      : await prisma.savingsPlan.create({ data: { customerId: cust.id, startDate, ...planData } })

    createdCustomers[c.customerId] = { id: cust.id, planId: plan.id }
  }

  // Transactions
  const txnBase = new Date('2026-05-17T09:00:00Z')

  const transactions = [
    {
      ref: 'TXN-9201',
      customerId: createdCustomers['CST-00312'].id,
      planId: createdCustomers['CST-00312'].planId,
      type: 'saving',
      amount: 2000,
      method: 'Cash',
      status: 'Done',
      offsetMins: 0,
    },
    {
      ref: 'TXN-9200',
      customerId: createdCustomers['CST-00289'].id,
      planId: createdCustomers['CST-00289'].planId,
      type: 'redemption',
      amount: 45000,
      method: 'Cash',
      status: 'Done',
      offsetMins: 33,
    },
    {
      ref: 'TXN-9199',
      customerId: createdCustomers['CST-00241'].id,
      planId: createdCustomers['CST-00241'].planId,
      type: 'saving',
      amount: 1500,
      method: 'Cash',
      status: 'Done',
      offsetMins: 81,
    },
    {
      ref: 'RPY-00534',
      customerId: createdCustomers['CST-00178'].id,
      type: 'repayment',
      amount: 10000,
      method: 'Cash',
      status: 'Done',
      offsetMins: 108,
    },
    {
      ref: 'ENR-00312',
      customerId: createdCustomers['CST-00312'].id,
      type: 'enrolment',
      amount: 0,
      method: 'Cash',
      status: 'Done',
      offsetMins: -3000,
    },
    {
      ref: 'ENR-00289',
      customerId: createdCustomers['CST-00289'].id,
      type: 'enrolment',
      amount: 0,
      method: 'Cash',
      status: 'Done',
      offsetMins: -4000,
    },
    {
      ref: 'ENR-00241',
      customerId: createdCustomers['CST-00241'].id,
      type: 'enrolment',
      amount: 0,
      method: 'Cash',
      status: 'Done',
      offsetMins: -5500,
    },
    {
      ref: 'DSB-00291',
      customerId: createdCustomers['CST-00178'].id,
      type: 'disbursement',
      amount: 30000,
      method: 'Cash',
      status: 'Done',
      offsetMins: -1440,
    },
    {
      ref: 'TXN-9198',
      customerId: createdCustomers['CST-00204'].id,
      planId: createdCustomers['CST-00204'].planId,
      type: 'saving',
      amount: 3000,
      method: 'Mobile Money',
      status: 'Done',
      offsetMins: 150,
    },
    {
      ref: 'TXN-9195',
      customerId: createdCustomers['CST-00190'].id,
      planId: createdCustomers['CST-00190'].planId,
      type: 'saving',
      amount: 1500,
      method: 'Cash',
      status: 'Done',
      offsetMins: -10080,
    },
    {
      ref: 'TXN-9190',
      customerId: createdCustomers['CST-00178'].id,
      planId: createdCustomers['CST-00178'].planId,
      type: 'saving',
      amount: 2500,
      method: 'Cash',
      status: 'Done',
      offsetMins: -20160,
    },
    {
      ref: 'TXN-9185',
      customerId: createdCustomers['CST-00312'].id,
      planId: createdCustomers['CST-00312'].planId,
      type: 'saving',
      amount: 2000,
      method: 'Cash',
      status: 'Done',
      offsetMins: -30240,
    },
  ]

  for (const t of transactions) {
    const createdAt = new Date(txnBase)
    createdAt.setMinutes(createdAt.getMinutes() + t.offsetMins)
    await prisma.transaction.upsert({
      where: { ref: t.ref },
      update: {},
      create: {
        ref: t.ref,
        agentId: agent.id,
        customerId: t.customerId,
        planId: (t as any).planId ?? null,
        type: t.type,
        amount: t.amount,
        method: t.method,
        status: t.status,
        createdAt,
      },
    })
  }

  // Loans
  const loan1DueDate = new Date('2026-08-14T00:00:00Z')
  const loan2DueDate = new Date('2026-07-16T00:00:00Z')
  const loan3DueDate = new Date('2026-04-15T00:00:00Z')

  const loan1 = await prisma.loan.upsert({
    where: { ref: 'LNR-00812' },
    update: {},
    create: {
      ref: 'LNR-00812',
      agentId: agent.id,
      customerId: createdCustomers['CST-00312'].id,
      principal: 30000,
      interestRate: 12,
      interestAmount: 3600,
      totalAmount: 33600,
      durationDays: 90,
      dueDate: loan1DueDate,
      status: 'Pending',
      createdAt: new Date('2026-05-16T10:00:00Z'),
    },
  })
  void loan1

  const loan2 = await prisma.loan.upsert({
    where: { ref: 'LNR-00809' },
    update: {},
    create: {
      ref: 'LNR-00809',
      agentId: agent.id,
      customerId: createdCustomers['CST-00178'].id,
      principal: 30000,
      interestRate: 12,
      interestAmount: 3600,
      totalAmount: 33600,
      durationDays: 90,
      dueDate: loan2DueDate,
      status: 'Disbursed',
      createdAt: new Date('2026-04-16T12:00:00Z'),
    },
  })

  await prisma.loanRepayment.create({
    data: {
      loanId: loan2.id,
      amount: 10000,
      method: 'Cash',
      createdAt: new Date('2026-05-17T11:48:00Z'),
    },
  })

  const loan3 = await prisma.loan.upsert({
    where: { ref: 'LNR-00795' },
    update: {},
    create: {
      ref: 'LNR-00795',
      agentId: agent.id,
      customerId: createdCustomers['CST-00289'].id,
      principal: 20000,
      interestRate: 8,
      interestAmount: 1600,
      totalAmount: 21600,
      durationDays: 60,
      dueDate: loan3DueDate,
      status: 'Repaid',
      createdAt: new Date('2026-02-14T09:00:00Z'),
    },
  })

  await prisma.loanRepayment.create({
    data: {
      loanId: loan3.id,
      amount: 21600,
      method: 'Cash',
      createdAt: new Date('2026-04-14T14:00:00Z'),
    },
  })

  // Commission for current month (May 2026) — 0.4% savings, ₦0 redemptions, ₦2/ea enrolments
  await prisma.commission.upsert({
    where: { agentId_month_year: { agentId: agent.id, month: 5, year: 2026 } },
    update: {
      amount: 808,
      breakdown: JSON.stringify({
        savings: { count: 198, volume: 198000, commission: 792 },
        redemptions: { count: 22, volume: 22000, commission: 0 },
        enrolments: { count: 8, commission: 16 },
      }),
    },
    create: {
      agentId: agent.id,
      month: 5,
      year: 2026,
      amount: 808,
      breakdown: JSON.stringify({
        savings: { count: 198, volume: 198000, commission: 792 },
        redemptions: { count: 22, volume: 22000, commission: 0 },
        enrolments: { count: 8, commission: 16 },
      }),
    },
  })

  // Issue reports
  await prisma.issueReport.createMany({
    data: [
      {
        agentId: agent.id,
        category: 'Transaction Dispute',
        title: 'Double deduction on TXN-9188',
        description: 'Customer Ngozi Eze was debited twice for a ₦2,000 saving on Apr 11. Kindly investigate and reverse the duplicate.',
        status: 'In Review',
        createdAt: new Date('2026-05-06T09:00:00Z'),
      },
      {
        agentId: agent.id,
        category: 'System Error',
        title: 'App crashed during loan disbursement',
        description: 'The app froze and crashed after confirming disbursement for LNR-00809. Not sure if it went through.',
        status: 'Open',
        createdAt: new Date('2026-05-10T14:30:00Z'),
      },
    ],
  })

  console.log('Seed complete: AGT-00142 / collo123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
