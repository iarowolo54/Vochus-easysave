// Tripwire: a customer's type (online = registered themselves, offline = registered by an agent) is stored on the
// customer, and each side opens only its own plans. Both plan-creation routes must ask the one guard, and nothing may
// go back to guessing the type from a customer's plans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

test('the customer app refuses plans for offline customers', () => {
  assert.match(readFileSync('src/app/api/customer/plan/route.ts', 'utf8'), /planCreationBlock\('customer'/)
})

test('agents are refused plans for online customers', () => {
  assert.match(readFileSync('src/app/api/customers/plan/route.ts', 'utf8'), /planCreationBlock\('agent'/)
})

test('nothing guesses the customer type from plans any more', () => {
  const guessing = files('src').filter(f => /\bcustomerType\(/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')))
  assert.deepEqual(guessing, [])
})
