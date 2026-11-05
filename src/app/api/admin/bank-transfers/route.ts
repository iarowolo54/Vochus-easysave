import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { TRANSFER_METHOD } from '@/lib/transfer-intent'
import { STATUS_LABEL, alertStatus, intentStatus, type TransferStatus } from '@/lib/transfer-status'

export const dynamic = 'force-dynamic'

const FETCH_LIMIT = 300
const PAGE_SIZE = 25
const FILTERS: readonly string[] = ['all', 'paid', 'waiting', 'not-paid', 'needs-review', 'by-hand']
const DAY_MS = 86_400_000

type Who = { type: 'customer' | 'agent'; name: string; code: string }
type Possible = { who: Who | null; plan: string | null; amount: number; startedAt: string; state: string }

type Row = {
  kind: 'request' | 'alert'
  id: string
  /** The request's reference, or the bank's own transaction id for a held payment. */
  ref: string
  /** When it started (a request) or when the bank took the money (a held payment). */
  at: string
  who: Who | null
  plan: string | null
  amount: number
  status: TransferStatus
  statusLabel: string
  /** One short line for the table. The full story is in the details view. */
  summary: string
  actionable: boolean
  // Everything below is for the details view.
  startedAt: string | null
  expiresAt: string | null
  creditedAt: string | null
  /** Staff who credited or dismissed it, when, and the note they gave. */
  by: string | null
  doneAt: string | null
  note: string | null
  bank: { sender: string; narration: string; txnId: string; bankTime: string; seenAt: string } | null
  /** Held money that matches nothing open: requests that were started for about this amount. */
  possible: Possible[]
  /** Held money with the same amount as a payment staff credited by hand recently. */
  lookalike: boolean
}

const summaryFor = (status: TransferStatus, manualBy: string | null): string => {
  if (status === 'paid') return 'Matched to the bank alert automatically'
  if (status === 'waiting') return 'Waiting for the money to arrive'
  if (status === 'not-paid') return 'Time ran out and no matching payment arrived'
  if (status === 'by-hand') return manualBy ? `Credited by hand by ${manualBy}` : 'Credited by hand'
  return 'Money arrived but couldn’t be credited'
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('bank-transfers', 'view')
  if (!guard.ok) return guard.response

  const url = req.nextUrl.searchParams
  const filter = FILTERS.includes(url.get('status') ?? '') ? (url.get('status') as string) : 'all'
  const q = (url.get('q') ?? '').trim().slice(0, 60).toLowerCase()
  const page = Math.max(1, Math.floor(Number(url.get('page')) || 1))

  // Requests made by hand from a held alert are shown through that alert, so they are left out here.
  const [intents, alerts] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: { method: TRANSFER_METHOD, NOT: { ref: { startsWith: 'VCHS-MAN-' } } },
      orderBy: { createdAt: 'desc' },
      take: FETCH_LIMIT,
    }),
    prisma.bankAlert.findMany({ where: { status: { in: ['Unmatched', 'Resolved', 'Dismissed'] } }, orderBy: { createdAt: 'desc' }, take: FETCH_LIMIT }),
  ])
  // Held money with the same amount as something staff credited by hand in the last 3 days: likely the same payment.
  const recentHand = await prisma.paymentIntent.findMany({
    where: { manualBy: { not: null }, status: 'Done', consumedAt: { gte: new Date(Date.now() - 3 * DAY_MS) } },
    select: { amount: true },
  })
  const handAmounts = new Set(recentHand.map((i) => i.amount.toFixed(2)))
  const manualRefs = alerts.map((a) => a.intentRef).filter((r): r is string => !!r)
  const manualIntents = manualRefs.length ? await prisma.paymentIntent.findMany({ where: { ref: { in: manualRefs } } }) : []

  const customerIds = [...new Set([...intents, ...manualIntents].map((i) => i.customerId).filter((x): x is string => !!x))]
  const agentIds = [...new Set([...intents, ...manualIntents].map((i) => i.agentId).filter((x): x is string => !!x))]
  const planIds = [...new Set([...intents, ...manualIntents].map((i) => i.planId).filter((x): x is string => !!x))]
  const [customers, agents, plans] = await Promise.all([
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, customerId: true, firstName: true, lastName: true } }) : [],
    agentIds.length ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, agentId: true, name: true } }) : [],
    planIds.length ? prisma.savingsPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, goal: true } }) : [],
  ])
  const cById = new Map(customers.map((c) => [c.id, c]))
  const aById = new Map(agents.map((a) => [a.id, a]))
  const pById = new Map(plans.map((p) => [p.id, p.goal]))
  const whoOf = (i: { customerId: string | null; agentId: string | null }): Who | null => {
    const c = i.customerId ? cById.get(i.customerId) : undefined
    if (c) return { type: 'customer', name: `${c.firstName} ${c.lastName}`, code: c.customerId }
    const a = i.agentId ? aById.get(i.agentId) : undefined
    return a ? { type: 'agent', name: a.name, code: a.agentId } : null
  }
  const iso = (d: Date | null) => (d ? d.toISOString() : null)

  const now = Date.now()
  const rows: Row[] = []
  for (const i of intents) {
    const status = intentStatus(i, now)
    rows.push({
      kind: 'request', id: i.id, ref: i.ref, at: i.createdAt.toISOString(), who: whoOf(i),
      plan: i.planId ? pById.get(i.planId) ?? null : null, amount: i.amount, status, statusLabel: STATUS_LABEL[status],
      summary: summaryFor(status, i.manualBy), actionable: status === 'waiting' || status === 'not-paid',
      startedAt: i.createdAt.toISOString(), expiresAt: iso(i.expiresAt), creditedAt: iso(i.consumedAt),
      by: i.manualBy, doneAt: i.manualBy ? iso(i.consumedAt) : null, note: i.manualNote,
      bank: null, possible: [], lookalike: false,
    })
  }
  const manualByRef = new Map(manualIntents.map((i) => [i.ref, i]))
  for (const a of alerts) {
    const s = alertStatus(a)
    if (s === 'dismissed') continue
    const mi = a.intentRef ? manualByRef.get(a.intentRef) : undefined
    const lookalike = a.status === 'Unmatched' && handAmounts.has(a.amount.toFixed(2))
    // Requests started in the day before this money arrived for about the same naira figure.
    const possible: Possible[] = a.status !== 'Unmatched' ? [] : intents
      .filter((i) => i.status === 'Pending' && Math.floor(i.amount) === Math.floor(a.amount)
        && i.createdAt.getTime() <= a.alertAt.getTime() && a.alertAt.getTime() - i.createdAt.getTime() <= DAY_MS)
      .slice(0, 5)
      .map((i) => ({ who: whoOf(i), plan: i.planId ? pById.get(i.planId) ?? null : null, amount: i.amount, startedAt: i.createdAt.toISOString(), state: STATUS_LABEL[intentStatus(i, now)] }))
    rows.push({
      kind: 'alert', id: a.id, ref: a.txnId, at: a.alertAt.toISOString(), who: mi ? whoOf(mi) : null,
      plan: mi?.planId ? pById.get(mi.planId) ?? null : null, amount: a.amount, status: s, statusLabel: STATUS_LABEL[s],
      summary: a.status === 'Unmatched'
        ? `From ${a.senderName || 'an unknown sender'}. No open request had this exact amount.${lookalike ? ' Same amount as a payment credited by hand.' : ''}`
        : `Credited by hand by ${a.resolvedBy ?? 'staff'}`,
      actionable: a.status === 'Unmatched',
      startedAt: null, expiresAt: null, creditedAt: null,
      by: a.resolvedBy, doneAt: iso(a.resolvedAt), note: a.resolvedNote,
      bank: { sender: a.senderName, narration: a.narration, txnId: a.txnId, bankTime: a.alertAt.toISOString(), seenAt: a.createdAt.toISOString() },
      possible, lookalike,
    })
  }
  rows.sort((x, y) => (x.at < y.at ? 1 : -1))

  const counts: Record<string, number> = { all: rows.length, paid: 0, waiting: 0, 'not-paid': 0, 'needs-review': 0, 'by-hand': 0 }
  for (const r of rows) counts[r.status]++

  const shown = rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (!q) return true
    const hay = `${r.who?.name ?? ''} ${r.who?.code ?? ''} ${r.plan ?? ''} ${r.amount.toFixed(2)} ${r.summary} ${r.note ?? ''} ${r.bank?.sender ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
  const start = (page - 1) * PAGE_SIZE
  return NextResponse.json({
    rows: shown.slice(start, start + PAGE_SIZE),
    total: shown.length,
    page,
    pageSize: PAGE_SIZE,
    counts,
    truncated: intents.length === FETCH_LIMIT || alerts.length === FETCH_LIMIT,
    canManage: (await requirePermission('bank-transfers', 'manage')).ok,
  })
}
