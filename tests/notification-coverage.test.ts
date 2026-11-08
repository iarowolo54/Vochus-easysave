// Tripwire (safeguard 3 of in-app notifications). Every write that changes a collection or a withdrawal, credits a plan,
// funds an agent wallet or registers a new phone must carry, within the 3 lines above it, a deliberate decision:
//   // notify: <catalogueName>        → and that file must actually call notifications.<catalogueName>(
//   // notify: none — <reason>        → a written reason, at least a few words
//   // notify: caller — <reason>      → a shared helper that writes the events its caller passes in; its call sites
//                                        are then write sites too, so each caller must name its notification
// A new money path that forgets the notification fails here before it can ship.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { notifications } from '../src/lib/notifications'

const ROOT = join(__dirname, '..')
const SCAN = ['src/app/api', 'src/lib']
const SKIP = new Set(['src/lib/notifications.ts', 'src/lib/notification-sweep.ts'])

const WRITES: { what: string; re: RegExp }[] = [
  { what: 'collection write', re: /\bearlyRedemption\.(update|updateMany|create|upsert)\(/ },
  { what: 'withdrawal write', re: /\bagentWithdrawal\.(update|updateMany|create|upsert)\(/ },
  { what: 'plan credit', re: /(?<!function )\b(creditPlanBalance|creditOpenPlan)\(/ },
  { what: 'wallet funding', re: /type:\s*'wallet_funding'/ },
  { what: 'new device session', re: /\bdeviceSession\.(create|upsert)\(/ },
  { what: 'ajo member joins', re: /\bajoMember\.create\(/ },
  { what: 'ajo contribution', re: /\bajoContribution\.create\(/ },
  { what: 'ajo payout', re: /\bajoPayout\.create\(/ },
  { what: 'collection request (helper)', re: /(?<!function )\bcreateRedemptionWithUniqueCode\(/ },
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []
  })
}

type Finding = { file: string; line: number; what: string; problem: string }

function scan(): Finding[] {
  const known = new Set(Object.keys(notifications))
  const out: Finding[] = []
  for (const abs of SCAN.flatMap(d => files(join(ROOT, d)))) {
    const file = relative(ROOT, abs)
    if (SKIP.has(file)) continue
    const lines = readFileSync(abs, 'utf8').split('\n')
    const src = lines.join('\n')
    lines.forEach((text, i) => {
      for (const w of WRITES) {
        if (!w.re.test(text) || /^\s*(\/\/|\*)/.test(text)) continue
        if (w.what === 'wallet funding' && !/create|data/.test(lines.slice(Math.max(0, i - 6), i + 1).join(' '))) continue
        const above = lines.slice(Math.max(0, i - 3), i).join('\n')
        const m = /\/\/\s*notify:\s*(.+)$/m.exec(above)
        if (!m) { out.push({ file, line: i + 1, what: w.what, problem: 'no `// notify:` decision above it' }); continue }
        const decision = m[1].trim()
        if (/^(none|caller)\b/.test(decision)) {
          if (!/^(none|caller)\s*[—-]\s*\S+(\s+\S+){2,}/.test(decision)) out.push({ file, line: i + 1, what: w.what, problem: '`notify: none|caller` needs a reason of a few words' })
          continue
        }
        for (const nameUsed of decision.split(/[,\s]+/).filter(Boolean)) {
          if (!known.has(nameUsed)) out.push({ file, line: i + 1, what: w.what, problem: `unknown notification "${nameUsed}"` })
          else if (!src.includes(`notifications.${nameUsed}(`)) out.push({ file, line: i + 1, what: w.what, problem: `says ${nameUsed} but the file never calls notifications.${nameUsed}(` })
        }
      }
    })
  }
  return out
}

test('every money/status write has a deliberate notification decision', () => {
  const f = scan()
  assert.equal(f.length, 0, '\n' + f.map(x => `  ${x.file}:${x.line} (${x.what}) — ${x.problem}`).join('\n'))
})
