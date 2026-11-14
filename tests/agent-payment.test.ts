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
