import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { idsWithPhoto, supportPhotoPath } from '@/lib/support-chat'

export const dynamic = 'force-dynamic'

type Person = { type: 'agent' | 'customer'; id: string; code: string; name: string; status: string; threadId: string | null; photoUrl: string | null }

/**
 * Who the office can start a chat with. ?q= searches agents and customers by name, ID or phone (10 of each);
 * ?agentId= or ?customerId= (database ids) looks up one person for the Message button on their page.
 * Names, codes and status; a photo only as a link to /api/admin/support/photo, never the image itself.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission('support', 'manage')
  if (!guard.ok) return guard.response

  const sp = new URL(req.url).searchParams
  const agentId = sp.get('agentId')
  const customerId = sp.get('customerId')
  const q = (sp.get('q') ?? '').trim().slice(0, 60)

  const agentSel = { id: true, agentId: true, name: true, status: true, supportThread: { select: { id: true } } } as const
  const custSel = { id: true, customerId: true, firstName: true, lastName: true, status: true, supportThread: { select: { id: true } } } as const

  type A = { id: string; agentId: string; name: string; status: string; supportThread: { id: string } | null }
  type C = { id: string; customerId: string; firstName: string; lastName: string; status: string; supportThread: { id: string } | null }
  const fromAgent = (a: A): Person => ({ type: 'agent', id: a.id, code: a.agentId, name: a.name, status: a.status, threadId: a.supportThread?.id ?? null, photoUrl: null })
  const fromCust = (c: C): Person => ({ type: 'customer', id: c.id, code: c.customerId, name: `${c.firstName} ${c.lastName}`, status: c.status, threadId: c.supportThread?.id ?? null, photoUrl: null })

  if (agentId || customerId) {
    const person = agentId
      ? await prisma.agent.findUnique({ where: { id: agentId }, select: agentSel }).then((a) => (a ? fromAgent(a) : null))
      : await prisma.customer.findUnique({ where: { id: customerId as string }, select: custSel }).then((c) => (c ? fromCust(c) : null))
    if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ person: (await withPhotoLinks([person]))[0] })
  }

  if (q.length < 2) return NextResponse.json({ people: [] })
  const words = q.split(/\s+/).slice(0, 4)
  const [agents, customers] = await Promise.all([
    prisma.agent.findMany({
      where: { OR: [{ agentId: { contains: q } }, { phone: { contains: q } }, { AND: words.map((w) => ({ name: { contains: w } })) }] },
      select: agentSel, take: 10, orderBy: { name: 'asc' },
    }),
    prisma.customer.findMany({
      where: { OR: [{ customerId: { contains: q } }, { phone: { contains: q } }, { AND: words.map((w) => ({ OR: [{ firstName: { contains: w } }, { lastName: { contains: w } }] })) }] },
      select: custSel, take: 10, orderBy: { firstName: 'asc' },
    }),
  ])
  return NextResponse.json({ people: await withPhotoLinks([...agents.map(fromAgent), ...customers.map(fromCust)]) })
}

/** Adds a lazy-loaded photo link for each person who has a photo. */
async function withPhotoLinks(people: Person[]): Promise<Person[]> {
  const has = await idsWithPhoto(prisma, people)
  return people.map((p) => ({ ...p, photoUrl: has.has(p.id) ? supportPhotoPath(p.type, p.id) : null }))
}
