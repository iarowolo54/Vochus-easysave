// Tripwire: references and IDs must never be numbered from a row count. A count goes DOWN when rows are deleted, so the
// next "new" number repeats one already used and the unique index refuses the write (this broke agent withdrawals on
// 2026-11-13 after test accounts were deleted). Use genTxnRef (random) for refs, or highest-existing + 1 for IDs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []
  })
}

test('no reference or ID is built from a row count', () => {
  const bad: string[] = []
  for (const f of [...files('src/app/api'), ...files('src/lib')]) {
    const src = readFileSync(f, 'utf8')
    // a count() result feeding a `PREFIX-${...}` template, directly or via a variable named *count*
    if (/`[A-Z]{2,5}-\$\{[^}]*(count\(\)|[cC]ount\b)[^}]*\}/.test(src)) bad.push(f)
  }
  assert.deepEqual(bad, [])
})
