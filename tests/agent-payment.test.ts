import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_PAID_ACTION, agentPaidAuditDetails, paidByLine } from '../src/lib/agent-payment'
import { notifications } from '../src/lib/notifications'

test('audit details name the agent, the amount, the online customer, the plan and the ref', () => {
  assert.equal(AGENT_PAID_ACTION, 'agent_paid_for_online_customer')
  assert.equal(
    agentPaidAuditDetails({ agentName: 'Ilori  Olawunmi', agentCode: 'AGT-00009', amount: 2000, customerName: 'yetunde salau', planGoal: 'General Savings', ref: 'TXN-1' }),
    'Agent Ilori Olawunmi (AGT-00009) paid ₦2,000 from the agent wallet into online customer Yetunde Salau’s plan “General Savings” (TXN-1)',
  )
  assert.equal(
    agentPaidAuditDetails({ agentName: 'Ilori Olawunmi', agentCode: 'AGT-00009', amount: 1500.5, customerName: 'Yetunde Salau', planGoal: 'G', ref: 'BLK-1', days: 3 }),
    'Agent Ilori Olawunmi (AGT-00009) paid ₦1,500.50 from the agent wallet into online customer Yetunde Salau’s plan “G” for 3 days (BLK-1)',
  )
})

test('paidByLine: the customer-facing line', () => {
  assert.equal(paidByLine('ilori  olawunmi'), 'Paid in by your agent, Ilori Olawunmi')
})

test('savingsReceived: an agent-paid deposit says who paid it in', () => {
  const [c] = notifications.savingsReceived({ ref: 'TXN-1', customerId: 'c1', agentId: 'a1', customerName: 'Y S', planGoal: 'General Savings', amount: 2000, onlineTransfer: false, paidByAgent: 'Ilori Olawunmi' })
  assert.equal(c.title, '₦2,000 saved into General Savings')
  assert.equal(c.body, 'Paid in by your agent, Ilori Olawunmi.')
  const [plain] = notifications.savingsReceived({ ref: 'TXN-2', customerId: 'c1', agentId: 'a1', customerName: 'Y S', planGoal: 'G', amount: 500, onlineTransfer: false })
  assert.equal(plain.body, undefined)
})

import { readFileSync } from 'node:fs'

test('an agent-paid first saving never pays the agent the registration reward; the customer’s own first deposit still does', () => {
  const single = readFileSync('src/app/api/transactions/saving/route.ts', 'utf8')
  const bulk = readFileSync('src/app/api/transactions/saving/bulk/route.ts', 'utf8')
  const settle = readFileSync('src/lib/customer-settle.ts', 'utf8')
  assert.match(single, /if \(priorSavings === 0 && !agentPaid\)/)
  assert.match(bulk, /if \(priorSavings === 0 && !online\)/)
  assert.match(settle, /type: 'saving', paidByAgentId: null/)
})
