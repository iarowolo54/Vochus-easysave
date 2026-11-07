// Tripwire: every text message costs money, so every place that sends one must say which rule allows it.
// Each `sendSMS(` call needs, within the 3 lines above it, a `// sms: <rule>` comment naming the reason.
// The allowed rules (owner, Nov 2026): cash customers get SMS for registration, the weekly alert (only with no email),
// collections, the roll-over code and a hand-approved deposit receipt; online customers get email, SMS only when they
// have no confirmed email; account-recovery codes fall back to SMS when there is no confirmed email. Agents and staff
// are outside this rule but are still marked.
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

test('every SMS send is marked with the rule that allows it', () => {
  const unmarked: string[] = []
  let sites = 0
  for (const f of files('src')) {
    if (f.endsWith(join('lib', 'kudisms.ts'))) continue // the sender itself
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '')
      if (!/\bsendSMS\(/.test(code)) return
      sites++
      const above = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
      if (!/\/\/ sms: \S/.test(above)) unmarked.push(`${f}:${i + 1}`)
    })
  }
  assert.ok(sites > 0, 'found no SMS sends; the scan is broken')
  assert.deepEqual(unmarked, [], `SMS sends without a "// sms: <rule>" comment:\n${unmarked.join('\n')}`)
})
