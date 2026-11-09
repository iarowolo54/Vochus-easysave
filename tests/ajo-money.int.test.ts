// Writes to the local dev.db (and cleans up after itself). Needs the seed test agent: npx tsx scripts/seed-test-agent.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { recordContribution, ajoRef, AjoAlreadyPaidError, AjoRoundClosedError } from '../src/lib/ajo-settle'
import { settleIntentPayment } from '../src/lib/customer-settle'
import { lagosMidnight } from '../src/lib/ajo'
import { replaceMember, stopAndRefund } from '../src/lib/ajo-admin'

test('ajo: rounds, races, transfers and payouts on a real database', async () => {
  const agent = await prisma.agent.findFirstOrThrow({ where: { agentId: 'AGT-UITEST' } })
  const custs = await prisma.customer.findMany({ where: { agentId: agent.id }, take: 3, orderBy: { createdAt: 'asc' } })
  assert.equal(custs.length, 3)
  const g = await prisma.ajoGroup.create({ data: { code: '9' + String(Date.now()).slice(-5), name: 'ZZ test', agentId: agent.id, cadence: 'weekly', size: 3, contribution: 1000, startDate: lagosMidnight('2026-11-10') } })
  const members = []
  for (const [i, c] of custs.entries()) members.push(await prisma.ajoMember.create({ data: { groupId: g.id, customerId: c.id, slot: 3 - i } }))
  await prisma.ajoGroup.update({ where: { id: g.id }, data: { status: 'Running', lockedAt: new Date() } })
  const pay = (m: { id: string }, round: number, amount = 1000) => prisma.$transaction(tx => recordContribution(tx, { groupId: g.id, memberId: m.id, round, amount, method: 'cash', ref: ajoRef('CON'), agentId: agent.id }))

  // Round 2 can't be paid while round 1 is open.
  await assert.rejects(pay(members[0], 2), AjoRoundClosedError)
  // Same member, same round, twice at once: exactly one wins.
  const both = await Promise.allSettled([pay(members[0], 1), pay(members[0], 1)])
  assert.equal(both.filter(r => r.status === 'fulfilled').length, 1, 'one of two simultaneous payments wins')
  await assert.rejects(pay(members[0], 1), AjoAlreadyPaidError)
  assert.equal((await pay(members[1], 1)).payout, null, 'not complete with 2 of 3')
  const last = await pay(members[2], 1)
  assert.ok(last.payout, 'third payment completes round 1')
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: last.payout!.savingsPlanId } })
  assert.equal(plan.balance, 3000); assert.equal(plan.cadence, 'ajo'); assert.equal(plan.customerId, custs[2].id, 'slot 1 holder gets round 1')
  assert.ok(plan.maturityDate.getTime() <= Date.now() && plan.status === 'Active')

  // Round 2 by bank transfer for one member, through the real settlement entry point.
  const intent = await prisma.paymentIntent.create({ data: { ref: 'ZZ-AJO-' + Date.now(), actorType: 'customer', customerId: custs[0].id, amount: 1000.37, method: 'transfer', expiresAt: new Date(Date.now() + 60000), ajoMemberId: members[0].id, ajoRound: 2 } })
  const wrong = await prisma.paymentIntent.create({ data: { ref: 'ZZ-AJO-W' + Date.now(), actorType: 'customer', customerId: custs[1].id, amount: 1000.41, method: 'transfer', expiresAt: new Date(Date.now() + 60000), ajoMemberId: members[1].id, ajoRound: 2 } })
  const r1 = await settleIntentPayment(prisma, { intent, reference: intent.ref, amountNaira: 1000.37, currency: 'NGN', channel: 'bank_transfer', via: 'Moniepoint transfer' })
  assert.equal(r1.kind, 'credited')
  const again = await settleIntentPayment(prisma, { intent: (await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })), reference: intent.ref, amountNaira: 1000.37, via: 'Moniepoint transfer' })
  assert.equal(again.kind, 'already', 'replayed alert does not pay twice')
  const r2 = await settleIntentPayment(prisma, { intent: wrong, reference: wrong.ref, amountNaira: 900, via: 'Moniepoint transfer' })
  assert.equal(r2.kind, 'review', 'wrong amount goes to staff')
  assert.equal(await prisma.ajoContribution.count({ where: { groupId: g.id, round: 2 } }), 1)
  await pay(members[1], 2); const r2done = await pay(members[2], 2)
  assert.equal(r2done.payout!.amount, 3000.37, 'kobo goes to the holder')
  const r3 = [await pay(members[0], 3), await pay(members[1], 3), await pay(members[2], 3)]
  assert.ok(r3[2].payout?.groupCompleted)
  assert.equal((await prisma.ajoGroup.findUniqueOrThrow({ where: { id: g.id } })).status, 'Completed')

  // Clean up everything this made.
  const payouts = await prisma.ajoPayout.findMany({ where: { groupId: g.id } })
  const refs = (await prisma.ajoContribution.findMany({ where: { groupId: g.id }, select: { ref: true } })).map(c => c.ref)
  await prisma.notification.deleteMany({ where: { OR: [
    { href: { contains: g.id } },
    { dedupeKey: { in: [...refs.map(r => `ajo-paid:${r}`), ...refs.map(r => `ajo-paid-agent:${r}`), ...payouts.map(p => `plan-ended:${p.savingsPlanId}`)] } },
  ] } })
  await prisma.ajoPayout.deleteMany({ where: { groupId: g.id } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: payouts.map(p => p.savingsPlanId) } } })
  await prisma.transaction.deleteMany({ where: { ref: { in: refs } } })
  await prisma.ajoContribution.deleteMany({ where: { groupId: g.id } })
  await prisma.ajoMember.deleteMany({ where: { groupId: g.id } })
  await prisma.ajoGroup.delete({ where: { id: g.id } })
  await prisma.paymentIntent.deleteMany({ where: { ref: { startsWith: 'ZZ-AJO-' } } })
})

async function setup(size: number) {
  const agent = await prisma.agent.findFirstOrThrow({ where: { agentId: 'AGT-UITEST' } })
  const custs = await prisma.customer.findMany({ where: { agentId: agent.id }, take: size + 1, orderBy: { createdAt: 'asc' } })
  const g = await prisma.ajoGroup.create({ data: { code: '8' + String(Date.now()).slice(-5), name: 'ZZ staff', agentId: agent.id, cadence: 'weekly', size, contribution: 1000, startDate: lagosMidnight('2026-11-10'), status: 'Running', lockedAt: new Date() } })
  const members = []
  for (let i = 0; i < size; i++) members.push(await prisma.ajoMember.create({ data: { groupId: g.id, customerId: custs[i].id, slot: i + 1 } }))
  const pay = (m: { id: string }, round: number) => prisma.$transaction(tx => recordContribution(tx, { groupId: g.id, memberId: m.id, round, amount: 1000, method: 'cash', ref: ajoRef('CON'), agentId: agent.id }))
  const clean = async () => {
    const refs = (await prisma.ajoContribution.findMany({ where: { groupId: g.id }, select: { ref: true } })).map(c => c.ref)
    const plans = (await prisma.savingsPlan.findMany({ where: { cadence: 'ajo', notes: { contains: g.id } }, select: { id: true } })).map(p => p.id)
    await prisma.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: 'ajo-' } }, { dedupeKey: { in: plans.map(id => `plan-ended:${id}`) } }] } })
    await prisma.ajoPayout.deleteMany({ where: { groupId: g.id } })
    await prisma.savingsPlan.deleteMany({ where: { id: { in: plans } } })
    await prisma.transaction.deleteMany({ where: { ref: { in: refs } } })
    await prisma.ajoContribution.deleteMany({ where: { groupId: g.id } })
    await prisma.ajoMember.deleteMany({ where: { groupId: g.id } })
    await prisma.ajoGroup.delete({ where: { id: g.id } })
  }
  return { g, custs, members, pay, clean }
}
const actor = { actorName: 'ZZ test' }

test('ajo staff: a replacement takes the turn and the old member is paid back from its pot', async () => {
  const { g, custs, members, pay, clean } = await setup(2)
  try {
    await pay(members[0], 1); await pay(members[1], 1)
    const refused = await replaceMember(prisma, { groupId: g.id, memberId: members[0].id, customerCode: custs[2].customerId, note: 'test', actor })
    assert.equal(refused.ok, false, 'a member who has collected cannot be replaced')
    const inGroup = await replaceMember(prisma, { groupId: g.id, memberId: members[1].id, customerCode: custs[0].customerId, note: 'test', actor })
    assert.equal(inGroup.ok, false, 'someone already in the group cannot be added')
    assert.deepEqual(await replaceMember(prisma, { groupId: g.id, memberId: members[1].id, customerCode: custs[2].customerId, note: 'test', actor }), { ok: true })
    assert.equal((await replaceMember(prisma, { groupId: g.id, memberId: members[1].id, customerCode: custs[1].customerId, note: 'test', actor })).ok, false, 'one handover per place')
    await pay(members[0], 2)
    const done = await pay(members[1], 2)
    assert.equal(done.payout!.customerId, custs[2].id, 'the new person collects the turn')
    assert.equal(done.payout!.amount, 1000, 'pot less what the old member paid in')
    assert.ok(done.payout!.groupCompleted)
    const back = await prisma.savingsPlan.findFirstOrThrow({ where: { cadence: 'ajo', customerId: custs[1].id, notes: { contains: g.id } } })
    assert.equal(back.balance, 1000); assert.match(back.goal, /^Ajo refund/)
  } finally { await clean() }
})

test('ajo staff: stopping refunds the open turn once, to the people who paid', async () => {
  const { g, custs, members, pay, clean } = await setup(3)
  try {
    await pay(members[0], 1); await pay(members[1], 1)
    const both = await Promise.all([stopAndRefund(prisma, { groupId: g.id, note: 'test', actor }), stopAndRefund(prisma, { groupId: g.id, note: 'test', actor })])
    assert.equal(both.filter(r => r.ok).length, 1, 'two staff stopping at once refund once')
    const plans = await prisma.savingsPlan.findMany({ where: { cadence: 'ajo', notes: { contains: g.id } } })
    assert.deepEqual(plans.map(p => p.customerId).sort(), [custs[0].id, custs[1].id].sort())
    assert.ok(plans.every(p => p.balance === 1000))
    assert.equal((await prisma.ajoGroup.findUniqueOrThrow({ where: { id: g.id } })).status, 'Stopped')
    await assert.rejects(pay(members[2], 1), AjoRoundClosedError)
  } finally { await clean(); await prisma.$disconnect() }
})
