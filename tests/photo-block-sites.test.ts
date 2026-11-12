// Tripwire: every place that STARTS putting savings in must check the photo deadline, and the paths that credit
// money already sent must not (docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MUST_CHECK = [
  'src/app/api/transactions/saving/route.ts',
  'src/app/api/transactions/saving/bulk/route.ts',
  'src/app/api/agent/ajo/[id]/contribution/route.ts',
  'src/app/api/customer/transfer/init/route.ts',
  'src/app/api/customer/catchup/init/route.ts',
  'src/app/api/customer/paystack/init/route.ts',
  'src/app/api/customer/ajo/[id]/transfer/route.ts',
  'src/app/api/customer/auto-debit/init/route.ts',
  'src/lib/auto-debit-run.ts',
]

test('every place that starts a saving checks the photo deadline', () => {
  const missing = MUST_CHECK.filter(f => !readFileSync(f, 'utf8').includes('photoSaveBlock('))
  assert.deepEqual(missing, [])
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
}

test('money already sent is never refused: bank-alert matching and hand credits do not check it', () => {
  const credit = [...walk('src/app/api/cron/bank-alerts'), ...walk('src/app/api/admin/bank-transfers'), 'src/lib/moniepoint-poll.ts', 'src/lib/customer-settle.ts', 'src/lib/transfer-intent.ts', 'src/lib/manual-credit.ts', 'src/lib/payment-intent.ts', 'src/lib/auto-debit-credit.ts']
    .filter(f => { try { return statSync(f).isFile() } catch { return false } })
  const offending = credit.filter(f => readFileSync(f, 'utf8').includes('photoSaveBlock('))
  assert.deepEqual(offending, [])
})
