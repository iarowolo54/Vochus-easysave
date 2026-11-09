// Unit test: the check behind an agent's single cash saving, against a stubbed database.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient, SavingsPlan } from '@prisma/client'
import { periodSavedOn } from '../src/lib/bulk-savings'
import { alreadySavedMessage, ALREADY_SAVED_TODAY } from '../src/lib/saving-plan'

const at = (key: string) => new Date(`${key}T09:00:00.000Z`)
const plan = (cadence: string, periodDays = 56) => ({
  id: 'p1', cadence, periodDays, startDate: at('2026-11-02'), maturityDate: at('2027-03-01'),
}) as SavingsPlan

function client(deposits: { key: string; ref?: string }[], coverage: { key: string; ref: string }[] = []) {
  return {
    transaction: { findMany: async () => deposits.map((d, i) => ({ createdAt: at(d.key), ref: d.ref ?? `T${i}` })) },
    planDayCoverage: { findMany: async () => coverage.map(c => ({ savingsPlanId: 'p1', coversKey: c.key, ref: c.ref })) },
    paymentIntent: { findMany: async () => [] },
  } as unknown as PrismaClient
}

test('weekly: a second saving in the same week is refused, on any day of it', async () => {
  assert.equal(await periodSavedOn(client([{ key: '2026-11-09' }]), plan('weekly'), at('2026-11-14')), true)
})

test('weekly: a late saving for an unpaid week is allowed', async () => {
  assert.equal(await periodSavedOn(client([{ key: '2026-11-09' }]), plan('weekly'), at('2026-11-03')), false)
})

test('daily: a day already bought through Bulk Savings is refused', async () => {
  assert.equal(await periodSavedOn(client([], [{ key: '2026-11-09', ref: 'B1' }]), plan('daily'), at('2026-11-09')), true)
})

test('daily: paying today for other days through Bulk Savings leaves today open', async () => {
  assert.equal(await periodSavedOn(client([{ key: '2026-11-09', ref: 'B1' }], [{ key: '2026-11-20', ref: 'B1' }]), plan('daily'), at('2026-11-09')), false)
})

test('flexible plans take any number of savings', async () => {
  assert.equal(await periodSavedOn(client([{ key: '2026-11-09' }]), plan('flexible'), at('2026-11-09')), false)
})

test('the refusal names the period', () => {
  assert.equal(alreadySavedMessage('daily'), ALREADY_SAVED_TODAY)
  assert.match(alreadySavedMessage('weekly'), /that week/)
  assert.match(alreadySavedMessage('monthly'), /that month/)
})
