/**
 * One-off repair (2026-11-12). Four cash first-day fees were refunded by hand to customers confirmed online
 * (audit `cash_fee_refunded`, actor Developer). That fix put the money right, but it EDITED history: it set each deposit's
 * fee to 0 and deleted its ledger rows, so no screen shows the refund. This script turns them into proper records
 * WITHOUT moving any money:
 *   1. restores each deposit's fee, its plan's feeCollected, and its 2 original ledger rows (same ids, dated at the deposit);
 *   2. writes the refund through writeRefundRecords({ moveMoney: false }): a `fee_refund` transaction the customer sees,
 *      the negative ledger rows, a notification to the customer and the agent, and an audit entry.
 * Balances (plans, agents' commission, platform revenue) must be identical before and after; it refuses otherwise.
 * It refuses to run twice (a fee_refund ledger row already exists for the deposit).
 *
 *   Dry run (rolls back):  npx tsx scripts/repair-fee-refunds-2026-11-12.ts --db /path/to/copy.db
 *   Apply:                 npx tsx scripts/repair-fee-refunds-2026-11-12.ts --db /path/to/dev.db --apply
 */
import { PrismaClient } from '@prisma/client'
import { money } from '../src/lib/money'
import { writeRefundRecords, REFUND_SOURCE } from '../src/lib/fee-refund'

type Repair = {
  who: string; depositId: string; depositRef: string; planId: string; agentId: string; fee: number; base: number
  agentRowId: string; agentShare: number; platformRowId: string; platformShare: number
}

// Facts read from production on 2026-11-12 and recorded in the four `cash_fee_refunded` audit entries.
const REPAIRS: Repair[] = [
  { who: 'Elizabeth Adedoyin', depositId: 'cmw1z2zld003og4l18nuksmzn', depositRef: 'TXN-9809', planId: 'cmv2flatt003c1097swyuiq6u', agentId: 'cmqzbhazx000ang4bpbz0hazy', fee: 500, base: 500, agentRowId: 'cmw1z2zl1003kg4l1wv4qi7sr', agentShare: 300, platformRowId: 'cmw1z2zla003mg4l1hx22h7gs', platformShare: 200 },
  { who: 'Lydia Ojelade', depositId: 'cmw43a4ln0006w93o40o0jt0r', depositRef: 'VCHS-TRF-1793914232070-AZ82G24Z', planId: 'cmv6hx2n1004r1097wif35pme', agentId: 'cmqzbhazx000ang4bpbz0hazy', fee: 500, base: 500.12, agentRowId: 'cmw43a4lg0002w93oz2rhaj2m', agentShare: 300, platformRowId: 'cmw43a4ll0004w93o19ti6ptd', platformShare: 200 },
  { who: 'Jeremiah Jeremiah', depositId: 'cmw2ce2t5006crqnx2k1e7fv1', depositRef: 'TXN-9825', planId: 'cmw0ewcum000110vcckmk651l', agentId: 'cmqv9sxp7000sc4h543fv1yfn', fee: 300, base: 300, agentRowId: 'cmw2ce2sz0068rqnxzwnth9zi', agentShare: 180, platformRowId: 'cmw2ce2t3006arqnxk3vfdf9x', platformShare: 120 },
  { who: 'Ololade Kabirat', depositId: 'cmw2cbm6h0065g4l1lmypa2yl', depositRef: 'TXN-9820', planId: 'cmvcu2qre00av109760r6crnk', agentId: 'cmqv9sxp7000sc4h543fv1yfn', fee: 200, base: 200, agentRowId: 'cmw2cbm6a0061g4l1n59o8o7s', agentShare: 120, platformRowId: 'cmw2cbm6g0063g4l14wth3rtg', platformShare: 80 },
]
const REASON = 'Online customer: the cash first-day fee did not apply. Refunded on 12 Nov 2026, approved by the owner.'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

class DryRun extends Error {}

async function main() {
  const db = arg('--db')
  if (!db) throw new Error('Pass --db <path to the SQLite file>')
  const apply = process.argv.includes('--apply')
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } })

  const balances = async () => {
    const plans = await prisma.savingsPlan.findMany({ where: { id: { in: REPAIRS.map(r => r.planId) } }, select: { id: true, balance: true } })
    const agents = await prisma.agent.findMany({ where: { id: { in: [...new Set(REPAIRS.map(r => r.agentId))] } }, select: { id: true, commissionBalance: true } })
    const revenue = await prisma.platformWallet.findUnique({ where: { type: 'Revenue' }, select: { balance: true } })
    return JSON.stringify({ plans: plans.map(p => [p.id, money(p.balance)]), agents: agents.map(a => [a.id, money(a.commissionBalance)]), revenue: money(revenue?.balance ?? 0) })
  }

  const before = await balances()
  console.log('Before:', before)
  try {
    await prisma.$transaction(async tx => {
      for (const r of REPAIRS) {
        const dep = await tx.transaction.findUnique({
          where: { id: r.depositId },
          select: { ref: true, type: true, agentId: true, customerId: true, planId: true, feeTaken: true, createdAt: true, plan: { select: { goal: true, source: true } }, customer: { select: { firstName: true, lastName: true } } },
        })
        if (!dep || dep.ref !== r.depositRef || dep.type !== 'saving' || dep.planId !== r.planId || dep.agentId !== r.agentId || !dep.customerId || !dep.plan || !dep.customer) {
          throw new Error(`${r.who}: deposit ${r.depositRef} is not as recorded`)
        }
        if (dep.plan.source !== 'self') throw new Error(`${r.who}: plan is not on online rules`)
        if (dep.feeTaken !== 0) throw new Error(`${r.who}: deposit already shows a fee (${dep.feeTaken}); already repaired?`)
        if (await tx.commissionLedger.findFirst({ where: { sourceRef: r.depositRef, source: REFUND_SOURCE } })) throw new Error(`${r.who}: already refunded`)
        if (await tx.commissionLedger.findFirst({ where: { id: { in: [r.agentRowId, r.platformRowId] } } })) throw new Error(`${r.who}: original ledger rows already exist`)

        // 1. Put back what the hand refund removed: the fee really was charged.
        await tx.transaction.update({ where: { id: r.depositId }, data: { feeTaken: r.fee } })
        await tx.savingsPlan.update({ where: { id: r.planId }, data: { feeCollected: r.fee } })
        const row = { source: 'daily_first', sourceRef: r.depositRef, customerId: dep.customerId, base: r.base, createdAt: dep.createdAt }
        await tx.commissionLedger.create({ data: { ...row, id: r.agentRowId, party: 'agent', agentId: r.agentId, ratePct: 60, amount: r.agentShare } })
        await tx.commissionLedger.create({ data: { ...row, id: r.platformRowId, party: 'platform', agentId: null, ratePct: 40, amount: r.platformShare } })

        // 2. The refund as its own record; the money already moved, so none moves here.
        const { ref } = await writeRefundRecords(tx, {
          deposit: { ref: r.depositRef, agentId: r.agentId, customerId: dep.customerId, planId: r.planId },
          planGoal: dep.plan.goal, customerName: `${dep.customer.firstName} ${dep.customer.lastName}`,
          split: { fee: r.fee, agentShare: r.agentShare, platformShare: r.platformShare },
          reason: REASON, actorName: 'Developer',
        }, { moveMoney: false })
        console.log(`${r.who}: fee ${r.fee} on ${r.depositRef} restored and refunded as ${ref}`)
      }
      if (!apply) throw new DryRun()
    }, { timeout: 30_000 })
  } catch (e) {
    if (!(e instanceof DryRun)) throw e
    console.log('Dry run: everything checked out and was rolled back. Re-run with --apply to write it.')
  }
  const after = await balances()
  console.log('After: ', after)
  if (after !== before) throw new Error('Balances changed. This must never happen; restore from the backup.')
  console.log('Balances identical.')
  await prisma.$disconnect()
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
