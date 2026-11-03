'use client'
// TEMPORARY: admin redesign preview with sample data (no sign-in). Delete after review. Not committed.
import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'
import AdminShell from '@/app/superadmin/_components/AdminShell'
import { useEffect, useState, type ComponentType } from 'react'
import Overview from '@/app/superadmin/page'
import Agents from '@/app/superadmin/agents/page'
import LoanRequests from '@/app/superadmin/loan-requests/page'
import LoanDisburse from '@/app/superadmin/loan-disburse/page'
import LoanRepay from '@/app/superadmin/loan-repay/page'
import LoanCalculator from '@/app/superadmin/loan-calculator/page'
import Reports from '@/app/superadmin/reports/page'
import Audit from '@/app/superadmin/audit/page'
import Devices from '@/app/superadmin/devices/page'
import AgentDetail from '@/app/superadmin/agents/[id]/page'
import AgentWallets from '@/app/superadmin/agent-wallets/page'
import AgentWithdrawals from '@/app/superadmin/agent-withdrawals/page'
import Commission from '@/app/superadmin/commission/page'
import Rewards from '@/app/superadmin/rewards/page'
import Customers from '@/app/superadmin/customers/page'
import SavingsMonitor from '@/app/superadmin/savings-monitor/page'
import EarlyRedemption from '@/app/superadmin/early-redemption/page'
import Transactions from '@/app/superadmin/transactions/page'
import WalletAccounts from '@/app/superadmin/wallet-accounts/page'
import Treasury from '@/app/superadmin/treasury/page'
import Cards from '@/app/superadmin/cards/page'
import CardsGenerate from '@/app/superadmin/cards/generate/page'
import GiftEditor from '@/app/superadmin/cards/gift-editor/page'
import Staff from '@/app/superadmin/staff/page'

const PAGES: Record<string, ComponentType> = {
  overview: Overview, agents: Agents, 'loan-requests': LoanRequests, 'loan-disburse': LoanDisburse, 'loan-repay': LoanRepay,
  'loan-calculator': LoanCalculator, reports: Reports, audit: Audit, devices: Devices,
  'agent-detail': AgentDetail,
  'agent-wallets': AgentWallets,
  'agent-withdrawals': AgentWithdrawals,
  'commission': Commission,
  'rewards': Rewards,
  'customers': Customers,
  'savings-monitor': SavingsMonitor,
  'early-redemption': EarlyRedemption,
  'transactions': Transactions,
  'wallet-accounts': WalletAccounts,
  'treasury': Treasury,
  cards: Cards, 'cards-generate': CardsGenerate, 'gift-editor': GiftEditor, staff: Staff,
}

const now = Date.now()
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString()
const SAMPLE: Record<string, unknown> = {
  '/api/admin/stats': { totalAgents: 42, totalCustomers: 1873, totalSavingsPool: 48250300, activeLoans: 17, activeLoansPortfolio: 3420000, pendingLoans: 3, pendingRedemptions: 2 },
  '/api/admin/transactions': { transactions: [
    { id: 't1', ref: 'SAV-88213', type: 'saving', amount: 2500, createdAt: iso(4), customerName: 'Adaeze Okafor', agentName: 'Musa Bello' },
    { id: 't2', ref: 'ENR-11902', type: 'enrolment', amount: 0, createdAt: iso(19), customerName: 'Tunde Afolabi', agentName: 'Grace Eze' },
    { id: 't3', ref: 'RED-00412', type: 'redemption', amount: 64000, createdAt: iso(55), customerName: 'Ngozi Umeh', agentName: 'Musa Bello' },
    { id: 't4', ref: 'LDS-00087', type: 'disbursement', amount: 150000, createdAt: iso(140), customerName: 'Ibrahim Sani', agentName: 'Kemi Ade' },
    { id: 't5', ref: 'LRP-00311', type: 'repayment', amount: 12500, createdAt: iso(300), customerName: 'Blessing John', agentName: 'Grace Eze' },
  ] },
  '/api/admin/loans?status=Pending': { loans: [
    { id: 'l1', ref: 'LN-00921', principal: 200000, customerName: 'Chinedu Obi', agentName: 'Musa Bello', status: 'Pending', createdAt: iso(60) },
    { id: 'l2', ref: 'LN-00922', principal: 75000, customerName: 'Fatima Yusuf', agentName: 'Kemi Ade', status: 'Pending', createdAt: iso(90) },
  ] },
  '/api/admin/agents': { agents: [
    { id: 'a1', agentId: 'AGT-00142', name: 'Musa Bello', phone: '08031234567', email: 'musa@example.com', emailVerified: true, location: 'Ikeja, Lagos', customerCount: 214, walletBalance: 182000, commission: 41250, status: 'Active', lockedAt: null, createdAt: iso(90000), profileUnlocked: false },
    { id: 'a2', agentId: 'AGT-00187', name: 'Grace Eze', phone: '08051112222', email: 'grace.eze@example.com', emailVerified: false, location: 'Enugu North', customerCount: 160, walletBalance: 95500, commission: 30210, status: 'Active', lockedAt: null, createdAt: iso(80000), profileUnlocked: true },
    { id: 'a3', agentId: 'AGT-00203', name: 'Kemi Ade', phone: '08099887766', email: null, emailVerified: false, location: 'Ibadan North', customerCount: 98, walletBalance: 12000, commission: 9800, status: 'Suspended', lockedAt: null, createdAt: iso(70000), profileUnlocked: false },
    { id: 'a4', agentId: 'AGT-00211', name: 'Yusuf Garba', phone: '08122223333', email: 'yusuf@example.com', emailVerified: true, location: 'Kano Municipal', customerCount: 0, walletBalance: 0, commission: 0, status: 'PendingActivation', lockedAt: null, createdAt: iso(600), profileUnlocked: false, docStatus: 'pending_approval', documents: [
      { docType: 'id', fileName: 'nin-slip.jpg', docApprovalStatus: 'approved' }, { docType: 'addr', fileName: 'phcn-bill-sept.pdf', docApprovalStatus: 'pending' }, { docType: 'guar', fileName: 'guarantor.pdf', docApprovalStatus: 'pending' }, { docType: 'agree', fileName: 'signature.png', docApprovalStatus: 'pending' } ] },
    { id: 'a5', agentId: 'AGT-00215', name: 'Amaka Nwosu', phone: '08144445555', email: 'amaka@example.com', emailVerified: true, location: 'Onitsha', customerCount: 0, walletBalance: 0, commission: 0, status: 'PendingActivation', lockedAt: null, createdAt: iso(300), profileUnlocked: false },
    { id: 'a6', agentId: 'AGT-00166', name: 'Segun Bakare', phone: '08166667777', email: 'segun@example.com', emailVerified: true, location: 'Abeokuta', customerCount: 57, walletBalance: 40100, commission: 7020, status: 'Active', lockedAt: iso(30), createdAt: iso(60000), profileUnlocked: false },
  ] },
}

const day = (n: number) => new Date(now + n * 86400e3).toISOString()
const loan = (i: number, status: string, name: string, agent: string, principal: number, days: number) => ({
  id: `l${i}`, ref: `LN-0092${i}`, principal, interestRate: 10, totalAmount: Math.round(principal * 1.1), durationDays: days, dueDate: day(days - 5),
  status, approvedBy: status === 'Pending' ? null : 'Super Admin', createdAt: iso(60 * i), customerName: name, customerId: `CST-4471${i}`, agentName: agent, agentId: 'AGT-00142',
})
Object.assign(SAMPLE, {
  '/api/admin/loans': { loans: [
    loan(1, 'Pending', 'Chinedu Obi', 'Musa Bello', 200000, 90), loan(2, 'Pending', 'Fatima Yusuf', 'Kemi Ade', 75000, 30),
    loan(3, 'Approved', 'Bola Tinubu-Ade', 'Grace Eze', 50000, 60), loan(4, 'Rejected', 'Peter Okon', 'Musa Bello', 300000, 180),
    loan(5, 'Disbursed', 'Halima Musa', 'Segun Bakare', 120000, 90),
  ] },
  '/api/admin/loan-disbursements': { totalDisbursed: 3, totalDisbursedAmount: 470000, totalOutstanding: 312000, overdueCount: 1, loans: [
    { ...loan(5, 'Disbursed', 'Halima Musa', 'Segun Bakare', 120000, 90), outstanding: 80000, isOverdue: false },
    { ...loan(6, 'Disbursed', 'Emeka Nnaji', 'Grace Eze', 200000, 30), dueDate: day(-4), outstanding: 132000, isOverdue: true },
    { ...loan(7, 'Disbursed', 'Ruth Adeyemi', 'Musa Bello', 150000, 60), dueDate: day(3), outstanding: 100000, isOverdue: false },
  ] },
  '/api/admin/loan-repayments': { totalRepayments: 42, totalAmount: 1260000, todayCount: 2, todayAmount: 25000, repayments: [
    { id: 'r1', loanRef: 'LN-00925', amount: 12500, method: 'cash', customerName: 'Halima Musa', customerId: 'CST-44715', agentName: 'Segun Bakare', agentId: 'AGT-00166', createdAt: iso(20) },
    { id: 'r2', loanRef: 'LN-00927', amount: 12500, method: 'transfer', customerName: 'Ruth Adeyemi', customerId: 'CST-44717', agentName: 'Musa Bello', agentId: 'AGT-00142', createdAt: iso(200) },
    { id: 'r3', loanRef: 'LN-00926', amount: 40000, method: 'cash', customerName: 'Emeka Nnaji', customerId: 'CST-44716', agentName: 'Grace Eze', agentId: 'AGT-00187', createdAt: iso(3000) },
  ] },
  '/api/admin/interest-rates': { rates: [ { durationDays: 30, label: '1 month', rate: 5 }, { durationDays: 90, label: '3 months', rate: 10 }, { durationDays: 180, label: '6 months', rate: 18 } ] },
  '/api/admin/reports': { openCount: 2, inReviewCount: 1, resolvedCount: 4, reports: [
    { id: 'p1', agentName: 'Musa Bello', agentId: 'AGT-00142', category: 'Payment', title: 'Customer paid but saving not showing', description: 'Adaeze paid ₦2,500 by transfer at 9am. It is not on her plan yet. Reference VCH-22819.', status: 'Open', createdAt: iso(45) },
    { id: 'p2', agentName: 'Grace Eze', agentId: 'AGT-00187', category: 'App', title: 'App logs me out every few minutes', description: 'Since yesterday the app signs me out while I am recording savings.', status: 'In Review', createdAt: iso(800) },
    { id: 'p3', agentName: 'Kemi Ade', agentId: 'AGT-00203', category: 'Card', title: 'Card scanner not reading QR', description: 'Camera opens but nothing happens.', status: 'Resolved', createdAt: iso(5000) },
  ] },
  '/api/admin/audit': { logs: [
    { id: 'u1', action: 'loan_approve', entity: 'Loan', entityId: 'l3', details: 'Loan LN-00923 ₦50000 approved for Bola Tinubu-Ade (CST-44713)', actorType: 'admin', actorId: null, actorName: 'SuperAdmin', createdAt: iso(30) },
    { id: 'u2', action: 'saving_record', entity: 'Transaction', entityId: 't1', details: 'Saving ₦2,500 for Adaeze Okafor', actorType: 'agent', actorId: 'a1', actorName: 'Musa Bello', createdAt: iso(70) },
    { id: 'u3', action: 'agent_password_change', entity: 'Agent', entityId: 'a2', details: 'Agent Grace Eze (AGT-00187) changed their password', actorType: 'agent', actorId: 'a2', actorName: 'Grace Eze', createdAt: iso(400) },
    { id: 'u4', action: 'loan_repayment', entity: 'Loan', entityId: 'l5', details: 'Repayment ₦12,500 on LN-00925', actorType: 'agent', actorId: 'a6', actorName: 'Segun Bakare', createdAt: iso(900) },
  ] },
  '/api/admin/devices': { devices: [
    { id: 'd1', deviceId: 'a9f3c1e2-77b0-4c1e-9d0a-1b2c3d4e5f60', app: 'agent', platform: 'android', model: 'Galaxy A14', manufacturer: 'Samsung', osVersion: '14', appVersion: '1.4.2', ipAddress: '102.89.33.10', firstSeenAt: iso(90000), lastSeenAt: iso(3), loginCount: 214, actor: { kind: 'agent', id: 'a1', ref: 'AGT-00142', name: 'Musa Bello', phone: '08031234567' } },
    { id: 'd2', deviceId: 'b1c2d3e4-0000-4c1e-9d0a-998877665544', app: 'customer', platform: 'ios', model: 'iPhone 12', manufacturer: 'Apple', osVersion: '17.5', appVersion: '1.2.0', ipAddress: '197.210.5.4', firstSeenAt: iso(20000), lastSeenAt: iso(1500), loginCount: 31, actor: { kind: 'customer', id: 'c1', ref: 'CST-44711', name: 'Adaeze Okafor', phone: '08061112233' } },
    { id: 'd3', deviceId: 'c0ffee00-1111-2222-3333-444455556666', app: 'agent', platform: 'android', model: null, manufacturer: null, osVersion: null, appVersion: null, ipAddress: null, firstSeenAt: iso(50000), lastSeenAt: iso(40000), loginCount: 2, actor: null },
  ] },
})

const tx = (i: number, type: string, amount: number, mins: number) => ({ id: `tx${i}`, ref: `${type.slice(0, 3).toUpperCase()}-8821${i}`, type, amount, method: i % 2 ? 'cash' : 'transfer', status: 'Done', note: null, createdAt: iso(mins) })
const cust = (i: number, first: string, last: string, extra: object = {}) => ({
  id: `c${i}`, customerId: `CST-4471${i}`, firstName: first, lastName: last, phone: `0806111223${i}`, email: i % 2 ? null : `${first.toLowerCase()}@example.com`,
  address: '12 Allen Avenue, Ikeja', status: 'Active', createdAt: iso(40000 + i * 100), photoUrl: null,
  savingsPlans: [{ id: `p${i}`, goal: 'School Fees', dailyAmount: 500, periodDays: 186, balance: 23500, status: 'Active', startDate: day(-47), maturityDate: day(139), notes: null, transactions: [tx(1, 'saving', 500, 60), tx(2, 'saving', 500, 1500)] }],
  loans: i === 1 ? [{ id: 'l5', ref: 'LN-00925', principal: 120000, totalAmount: 132000, interestRate: 10, durationDays: 90, dueDate: day(40), status: 'Disbursed', createdAt: iso(9000), repayments: [{ id: 'rp1', amount: 12500, createdAt: iso(20) }] }] : [],
  memberCards: i === 1 ? [{ serial: 'VES-NFC-00841', status: 'Linked', linkedAt: iso(30000) }] : [],
  ...extra,
})
const ADMIN_CUSTOMERS = [
  { id: 'c1', customerId: 'CST-44711', name: 'Adaeze Okafor', phone: '08061112231', email: 'adaeze@example.com', address: '12 Allen Avenue, Ikeja', status: 'Active', agentName: 'Musa Bello', agentId: 'AGT-00142', totalBalance: 23500, activePlans: 1, createdAt: iso(40100), gender: 'Female', state: 'Lagos', lga: 'Ikeja', type: 'online', lastPaidAt: iso(1500) },
  { id: 'c2', customerId: 'CST-44712', name: 'Tunde Afolabi', phone: '08061112232', email: null, address: '3 Ring Road, Ibadan', status: 'Active', agentName: 'Grace Eze', agentId: 'AGT-00187', totalBalance: 118200, activePlans: 2, createdAt: iso(40200), gender: null, state: null, lga: null, type: 'offline', lastPaidAt: iso(7300) },
  { id: 'c4', customerId: 'CST-44714', name: 'Mama Ada Nwachukwu', phone: '08061112234', email: null, address: 'Oja Oba Market, Ibadan', status: 'Active', agentName: 'Grace Eze', agentId: 'AGT-00187', totalBalance: 48000, activePlans: 1, createdAt: iso(39000), type: 'offline', lastPaidAt: iso(30) },
  { id: 'c3', customerId: 'CST-44713', name: 'Ngozi Umeh', phone: '08061112233', email: 'ngozi@example.com', address: '5 Zik Avenue, Enugu', status: 'Locked', agentName: 'Musa Bello', agentId: 'AGT-00142', totalBalance: 0, activePlans: 0, createdAt: iso(40300), type: 'offline', lastPaidAt: null },
]
const PLATFORM = { wallets: [
  { id: 'w1', type: 'Capital', balance: 25000000, updatedAt: iso(100) }, { id: 'w2', type: 'Float', balance: 2350000, updatedAt: iso(30) },
  { id: 'w3', type: 'SavingsPool', balance: 48250300, updatedAt: iso(4) }, { id: 'w4', type: 'Redemption', balance: 1200000, updatedAt: iso(55) }, { id: 'w5', type: 'Revenue', balance: 812400, updatedAt: iso(4) },
], totalAgentFloat: 329600, totalAgentCommission: 87280, totalCustomerSavings: 48250300, lowBalanceAgents: 2, totalAgents: 6, agentsLoaded: true,
  today: { savings: 152500, redemptions: 64000, registrations: 3, walletFunding: 200000, disbursements: 150000, repayments: 25000 } }
const WALLETS = { totalWalletBalance: 329600, totalFundedToday: 200000, lowBalanceCount: 2, agents: [
  { id: 'a1', agentId: 'AGT-00142', name: 'Musa Bello', location: 'Ikeja, Lagos', walletBalance: 182000, commissionBalance: 41250, floatLimit: 300000, status: 'Active', todayActivity: 14, lastFunded: iso(300) },
  { id: 'a2', agentId: 'AGT-00187', name: 'Grace Eze', location: 'Enugu North', walletBalance: 95500, commissionBalance: 30210, floatLimit: null, status: 'Active', todayActivity: 9, lastFunded: iso(3000) },
  { id: 'a3', agentId: 'AGT-00203', name: 'Kemi Ade', location: 'Ibadan North', walletBalance: 8000, commissionBalance: 0, status: 'Suspended', todayActivity: 0, lastFunded: null },
  { id: 'a6', agentId: 'AGT-00166', name: 'Segun Bakare', location: 'Abeokuta', walletBalance: 4100, commissionBalance: 7020, status: 'Active', todayActivity: 2, lastFunded: iso(9000) },
] }
const red = (i: number, status: string, extra: object = {}) => ({
  id: `rd${i}`, ref: `RED-0041${i}`, type: 'early', reason: 'School fees due', note: null, status, balance: 64000, penalty: 12800, netPayout: 51200,
  token: null, tokenExpiry: null, payoutMethod: i % 2 ? 'bank' : 'cash', accountNumber: i % 2 ? '0123456789' : null, accountName: i % 2 ? 'NGOZI UMEH' : null, bankName: i % 2 ? 'GTBank' : null,
  bankTransferStatus: null, requestedAt: iso(120 * i), decidedAt: status === 'Pending' ? null : iso(60), decidedBy: status === 'Pending' ? null : 'Super Admin',
  customerName: ['Ngozi Umeh', 'Ibrahim Sani', 'Blessing John', 'Tunde Afolabi'][i % 4], customerId: `CST-4471${i}`, agentName: 'Musa Bello', agentId: 'AGT-00142', savingsPlanId: `p${i}`, planStatus: 'Active', ...extra,
})
Object.assign(SAMPLE, {
  '/api/admin/commission': { totalPending: 78480, totalDisbursed: 412300, leaderboard: [
    { rank: 1, id: 'a1', agentId: 'AGT-00142', name: 'Musa Bello', status: 'Active', customerCount: 214, savingsVolume: 10312000, commissionBalance: 41250 },
    { rank: 2, id: 'a2', agentId: 'AGT-00187', name: 'Grace Eze', status: 'Active', customerCount: 160, savingsVolume: 7552000, commissionBalance: 30210 },
    { rank: 3, id: 'a6', agentId: 'AGT-00166', name: 'Segun Bakare', status: 'Active', customerCount: 57, savingsVolume: 1755000, commissionBalance: 7020 },
  ] },
  '/api/admin/commission/rates': { rates: { dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60, agentLoan: 1.0, agentRepay: 0.5, platformLoan: 5.0, platformPenalty: 2.0 } },
  '/api/admin/rewards': { totalAmount: 4200, totalCount: 12, promos: [
    { id: 'pr1', name: 'Registration Reward', startDate: day(-20), endDate: day(10), offlineRewardAmount: 200, onlineRewardAmount: 500, isActive: true, createdAt: iso(30000) },
    { id: 'pr2', name: 'Easter push', startDate: day(-200), endDate: day(-180), offlineRewardAmount: 100, onlineRewardAmount: 300, isActive: false, createdAt: iso(300000) },
  ], rewards: [
    { id: 'rw1', agentId: 'a1', customerId: 'c1', type: 'offline', amount: 200, narration: 'Registration reward', createdAt: iso(200), agent: { name: 'Musa Bello', agentId: 'AGT-00142' }, customer: { firstName: 'Adaeze', lastName: 'Okafor', customerId: 'CST-44711' }, promo: { name: 'Registration Reward' } },
    { id: 'rw2', agentId: 'a2', customerId: 'c2', type: 'online', amount: 500, narration: 'Registration reward', createdAt: iso(900), agent: { name: 'Grace Eze', agentId: 'AGT-00187' }, customer: { firstName: 'Tunde', lastName: 'Afolabi', customerId: 'CST-44712' }, promo: { name: 'Registration Reward' } },
  ] },
  '/api/admin/agent-withdrawal': { pending: 2, approved: 5, rejected: 1, totalPaidOut: 186000, records: [
    { id: 'w1', ref: 'AWD-00031', agentId: 'a1', agentName: 'Musa Bello', agentDisplayId: 'AGT-00142', agentPhone: '08031234567', agentCommissionBalance: 41250, amount: 40000, note: 'Monthly payout', status: 'Pending', bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'MUSA BELLO', bankTransferStatus: null, paystackTransferCode: null, adminNote: null, requestedAt: iso(90), decidedAt: null, decidedBy: null },
    { id: 'w2', ref: 'AWD-00032', agentId: 'a2', agentName: 'Grace Eze', agentDisplayId: 'AGT-00187', agentPhone: '08051112222', agentCommissionBalance: 30210, amount: 25000, note: null, status: 'AwaitingOTP', bankCode: '044', bankName: 'Access Bank', accountNumber: '0987654321', accountName: 'GRACE EZE', bankTransferStatus: 'otp', paystackTransferCode: 'TRF_x1', adminNote: null, requestedAt: iso(300), decidedAt: null, decidedBy: null },
    { id: 'w3', ref: 'AWD-00029', agentId: 'a6', agentName: 'Segun Bakare', agentDisplayId: 'AGT-00166', agentPhone: '08166667777', agentCommissionBalance: 7020, amount: 15000, note: null, status: 'Approved', bankCode: '033', bankName: 'UBA', accountNumber: '1122334455', accountName: 'SEGUN BAKARE', bankTransferStatus: 'success', paystackTransferCode: 'TRF_x0', adminNote: null, requestedAt: iso(9000), decidedAt: iso(8000), decidedBy: 'Super Admin' },
  ] },
  '/api/admin/wallets': WALLETS,
  '/api/admin/wallets/platform': PLATFORM,
  '/api/admin/savings-interest': { current: 12, history: [{ effectiveFrom: iso(60 * 24 * 20), annualRate: 12 }] },
  '/api/admin/customers': { customers: typeof window !== 'undefined' && location.search.includes('old=1') ? ADMIN_CUSTOMERS.map(({ type: _t, lastPaidAt: _l, ...c }) => c) : ADMIN_CUSTOMERS, total: 4 },
  '/api/admin/savings': { total: 3, totalActivePlans: 1207, totalSavingsPool: 48250300, maturingThisWeek: 18, maturingToday: 3, plans: [
    { id: 'p1', customerName: 'Adaeze Okafor', customerId: 'CST-44711', agentName: 'Musa Bello', agentId: 'AGT-00142', balance: 23500, dailyAmount: 500, periodDays: 186, startDate: day(-47), maturityDate: day(139), status: 'Active', goal: 'School Fees' },
    { id: 'p2', customerName: 'Tunde Afolabi', customerId: 'CST-44712', agentName: 'Grace Eze', agentId: 'AGT-00187', balance: 93000, dailyAmount: 1000, periodDays: 93, startDate: day(-93), maturityDate: day(0), status: 'Active', goal: 'Business Capital' },
    { id: 'p3', customerName: 'Ngozi Umeh', customerId: 'CST-44713', agentName: 'Musa Bello', agentId: 'AGT-00142', balance: 64000, dailyAmount: 2000, periodDays: 31, startDate: day(-40), maturityDate: day(-9), status: 'Matured', goal: 'House Rent' },
  ] },
  '/api/admin/early-redemption': { pending: 2, approved: 6, rejected: 1, tokensToday: 1, records: [red(1, 'Pending'), red(2, 'Pending'), red(3, 'AwaitingOTP', { bankTransferStatus: 'otp' }), red(4, 'Approved'), red(5, 'Rejected', { note: 'Plan is 3 days from maturity' })] },
  '/api/admin/redemptions': { totalRedemptions: 37, totalRedeemedAmount: 2840000, todayCount: 1, todayAmount: 64000, redemptions: [
    { id: 'cr1', ref: 'RED-00412', amount: 64000, customerName: 'Ngozi Umeh', customerId: 'CST-44713', agentName: 'Musa Bello', agentId: 'AGT-00142', method: 'cash', status: 'Done', createdAt: iso(55) },
  ] },
  '/api/admin/transactions': { transactions: [
    { id: 't1', ref: 'SAV-88213', type: 'saving', amount: 2500, method: 'cash', status: 'Done', createdAt: iso(4), agentName: 'Musa Bello', agentId: 'AGT-00142', customerName: 'Adaeze Okafor', customerId: 'CST-44711' },
    { id: 't2', ref: 'WFD-00118', type: 'wallet_funding', amount: 200000, method: 'transfer', status: 'Done', createdAt: iso(300), agentName: 'Musa Bello', agentId: 'AGT-00142', customerName: null, customerId: null },
    { id: 't3', ref: 'RED-00412', type: 'redemption', amount: 64000, method: 'cash', status: 'Done', createdAt: iso(55), agentName: 'Musa Bello', agentId: 'AGT-00142', customerName: 'Ngozi Umeh', customerId: 'CST-44713' },
    { id: 't4', ref: 'LRP-00311', type: 'repayment', amount: 12500, method: 'transfer', status: 'Pending', createdAt: iso(300), agentName: 'Grace Eze', agentId: 'AGT-00187', customerName: 'Blessing John', customerId: 'CST-44719' },
  ] },
})
const AGENT_DETAIL = { agent: { id: 'a1', agentId: 'AGT-00142', name: 'Musa Bello', phone: '08031234567', email: 'musa@example.com', location: 'Ikeja, Lagos', walletBalance: 182000, status: 'Active', createdAt: iso(90000), photoUrl: null,
  boundDeviceId: 'a9f3c1e2-77b0-4c1e-9d0a-1b2c3d4e5f60', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'MUSA BELLO',
  customers: [cust(1, 'Adaeze', 'Okafor'), cust(2, 'Chinedu', 'Obi'), cust(3, 'Ngozi', 'Umeh', { status: 'Locked' })],
  transactions: [tx(1, 'saving', 2500, 4), tx(2, 'wallet_funding', 200000, 300), tx(3, 'redemption', 64000, 55)],
  memberCards: [{ serial: 'VES-NFC-00841', status: 'Linked' }, { serial: 'VES-NFC-00842', status: 'Unlinked' }] } }

const card = (i: number, status: string, cust: string | null) => ({ id: `cd${i}`, serial: `VES-NFC-0084${i}`, batchName: 'Lagos launch', batchId: 'b1', expiryDate: day(700), status,
  linkedAt: cust ? iso(3000 * i) : null, customerName: cust, customerId: cust ? `CST-4471${i}` : null, agentName: cust ? 'Musa Bello' : null, agentId: cust ? 'AGT-00142' : null })
Object.assign(SAMPLE, {
  '/api/admin/cards/batches': {
    batches: [
      { batchId: 'b1', batchName: 'Lagos launch', expiryDate: day(700), createdAt: iso(60000), total: 500, linked: 212, unlinked: 286 },
      { batchId: 'b2', batchName: 'Enugu pilot', expiryDate: day(-10), createdAt: iso(600000), total: 100, linked: 61, unlinked: 39 },
    ],
    cards: [card(1, 'Linked', 'Adaeze Okafor'), card(2, 'Linked', 'Chinedu Obi'), card(3, 'Unlinked', null), card(4, 'Blocked', null), card(5, 'Unlinked', null)],
  },
  '/api/admin/staff': { staff: [
    { id: 's1', name: 'Halima Abubakar', email: 'halima@vochus.ng', role: 'Ops Manager', permissions: '["Agents", "Customers", "Reports"]', status: 'Active', lastActiveAt: null, createdAt: iso(90000) },
    { id: 's2', name: 'Femi Johnson', email: 'femi@vochus.ng', role: 'Finance', permissions: '["Wallets", "Commission", "Loans", "Transactions"]', status: 'Active', lastActiveAt: null, createdAt: iso(50000) },
    { id: 's3', name: 'Joy Etim', email: 'joy@vochus.ng', role: 'Support', permissions: '["Customers"]', status: 'Suspended', lastActiveAt: null, createdAt: iso(20000) },
  ] },
})

if (typeof window !== 'undefined' && !(window as { __adminMock?: boolean }).__adminMock) {
  (window as { __adminMock?: boolean }).__adminMock = true
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const path = url.replace(location.origin, '')
    const bare = path.split('?')[0]
    if (location.search.includes('failget=1') && path.startsWith('/api/')) return new Response('{}', { status: 500 })
    if ((init?.method ?? 'GET') !== 'GET' && location.search.includes('fail=1')) return new Response(JSON.stringify({ error: 'Paystack declined the transfer: the Vochus balance is too low. Fund the Paystack account, then try again.' }), { status: 400 })
    const hit = path in SAMPLE ? SAMPLE[path] : (init?.method ?? 'GET') === 'GET' && bare in SAMPLE ? SAMPLE[bare] : undefined
    if (/^\/api\/admin\/agents\/[^/]+\/detail/.test(bare)) return new Response(JSON.stringify(AGENT_DETAIL), { status: 200 })
    if (hit !== undefined) return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path.startsWith('/api/admin/')) return new Response(JSON.stringify({ loan: {} }), { status: 200 })
    return real(input, init)
  }
}

const session = { user: { name: 'Daniel Aboderin', email: 'admin@vochus.ng' }, expires: new Date(now + 3600e3).toISOString() } as unknown as Session

export default function AdminPreview() {
  const [key, setKey] = useState('overview')
  useEffect(() => { setKey(new URLSearchParams(location.search).get('p') ?? 'overview') }, [])
  const Page = PAGES[key] ?? Overview
  return (
    <SessionProvider session={session} basePath="/api/admin-auth" refetchOnWindowFocus={false}>
      <AdminShell><Page /></AdminShell>
    </SessionProvider>
  )
}
