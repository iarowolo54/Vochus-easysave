// Integration test for atomic balance debits (finding #4: read-then-write debits
// let concurrent requests overdraw). Runs against the worktree's local dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { debitAgentBalance } from '../src/lib/wallet-debit'

const rid = Math.random().toString(36).slice(2, 10)
let agentId = ''

before(async () => {
  const a = await prisma.agent.create({
    data: { agentId: `ATOM-${rid}`, phone: `0709${rid}`, name: 'Atom', location: 'x', password: 'x', walletBalance: 100 },
  })
  agentId = a.id
})

after(async () => {
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('concurrent debits never overdraw the wallet', async () => {
  // 10 concurrent debits of 20 against a balance of 100 → only 5 can succeed.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => debitAgentBalance(prisma, agentId, 'walletBalance', 20)),
  )
  assert.equal(results.filter(Boolean).length, 5)
  const after = await prisma.agent.findUnique({ where: { id: agentId } })
  assert.equal(after?.walletBalance, 0)
  assert.ok((after?.walletBalance ?? -1) >= 0) // never negative
})

test('a debit larger than the balance fails and changes nothing', async () => {
  await prisma.agent.update({ where: { id: agentId }, data: { walletBalance: 50 } })
  assert.equal(await debitAgentBalance(prisma, agentId, 'walletBalance', 999), false)
  const after = await prisma.agent.findUnique({ where: { id: agentId } })
  assert.equal(after?.walletBalance, 50)
})
