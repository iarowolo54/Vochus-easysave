// A plan stops taking deposits once its maturity date has passed, whatever its stored status says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planHasEnded } from '../src/lib/plan-credit'

const now = new Date('2026-11-03T12:00:00Z')

test('a plan is open before its maturity date', () => {
  assert.equal(planHasEnded({ maturityDate: new Date('2026-11-04T00:00:00Z') }, now), false)
})

test('a plan has ended on and after its maturity date', () => {
  assert.equal(planHasEnded({ maturityDate: now }, now), true)
  assert.equal(planHasEnded({ maturityDate: new Date('2026-10-01T00:00:00Z') }, now), true)
})
