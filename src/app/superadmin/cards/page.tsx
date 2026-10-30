'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, LoadError, Modal, PageHeader, Pager, RowMenu, SearchField, Segmented,
  TableSkeleton, shortDate, useDebounced, useToast,
} from '../_components/admin-ui'

interface Batch {
  batchId: string; batchName: string; expiryDate: string; createdAt: string
  total: number; linked: number; unlinked: number
}

interface CardRow {
  id: string; serial: string; batchName: string; batchId: string
  expiryDate: string; status: string; linkedAt: string | null
  customerName: string | null; customerId: string | null
  agentName: string | null; agentId: string | null
}

interface CustomerHit {
  id: string; customerId: string; name: string; phone: string
  status: string; agentName: string; photoUrl?: string | null
}

type Tab = 'batches' | 'cards'
type StatusFilter = 'All' | 'Linked' | 'Unlinked' | 'Blocked'

const PAGE_SIZE = 50

/** Date format used inside the batch PDF. Kept separate so the printed output doesn't change. */
function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0)

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'Linked') return <span className="bdg bdg-g">Linked</span>
  if (status === 'Unlinked') return <span className="bdg bdg-a">Not linked</span>
  if (status === 'Blocked') return <span className="bdg bdg-r">Blocked</span>
  return <span className="bdg bdg-grey">{status}</span>
}

export default function CardManagementPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('batches')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [batchFilter, setBatchFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [pdfBatch, setPdfBatch] = useState('')
  const [toastNode, toast] = useToast()

  // Unlink
  const [unlinkTarget, setUnlinkTarget] = useState<CardRow | null>(null)
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  const [unlinkError, setUnlinkError] = useState('')

  // Link / relink: pick a customer, then confirm
  const [linkCard, setLinkCard] = useState<CardRow | null>(null)
  const [linkStep, setLinkStep] = useState<'pick' | 'confirm'>('pick')
  const [picked, setPicked] = useState<CustomerHit | null>(null)
  const [custSearch, setCustSearch] = useState('')
  const custQ = useDebounced(custSearch.trim())
  const [hits, setHits] = useState<CustomerHit[]>([])
  const [hitsLoading, setHitsLoading] = useState(false)
  const [hitsFailed, setHitsFailed] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  const searchSeq = useRef(0)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/cards/batches')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setBatches(d.batches ?? [])
      setCards(d.cards ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter, batchFilter])

  const searchCustomers = useCallback(async () => {
    if (custQ.length < 2) { setHits([]); setHitsFailed(false); setHitsLoading(false); return }
    const seq = ++searchSeq.current
    setHitsLoading(true); setHitsFailed(false)
    try {
      const res = await fetch(`/api/admin/customers?search=${encodeURIComponent(custQ)}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { customers?: CustomerHit[] }
      if (seq === searchSeq.current) setHits((d.customers ?? []).slice(0, 20))
    } catch {
      if (seq === searchSeq.current) setHitsFailed(true)
    } finally {
      if (seq === searchSeq.current) setHitsLoading(false)
    }
  }, [custQ])

  useEffect(() => { if (linkCard) searchCustomers() }, [linkCard, searchCustomers])

  const counts = {
    All: cards.length,
    Linked: cards.filter(c => c.status === 'Linked').length,
    Unlinked: cards.filter(c => c.status === 'Unlinked').length,
    Blocked: cards.filter(c => c.status === 'Blocked').length,
  }

  const q = search.trim().toLowerCase()
  const filteredCards = cards.filter(c => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false
    if (batchFilter !== 'All' && c.batchId !== batchFilter) return false
    if (q) {
      return c.serial.toLowerCase().includes(q) ||
        (c.customerName ?? '').toLowerCase().includes(q) ||
        (c.agentName ?? '').toLowerCase().includes(q)
    }
    return true
  })
  const paginated = filteredCards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtering = !!q || statusFilter !== 'All' || batchFilter !== 'All'
  const batchName = (id: string) => batches.find(b => b.batchId === id)?.batchName ?? 'this batch'

  function clearFilters() { setSearch(''); setStatusFilter('All'); setBatchFilter('All') }

  async function downloadBatchPDF(batch: Batch) {
    const batchCards = cards.filter(c => c.batchId === batch.batchId)
    if (!batchCards.length) { toast('This batch has no cards to print.'); return }
    setPdfBatch(batch.batchId)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const PW = 210, margin = 10, pairGap = 6, rowGap = 6
      const CW = (PW - 2 * margin - pairGap) / 2
      const CH = CW / 1.586
      let y = margin

      doc.setFontSize(14); doc.setFont('helvetica', 'bold')
      doc.text(`${batch.batchName}`, PW / 2, y + 6, { align: 'center' })
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`Expiry: ${fmt(batch.expiryDate)}  |  ${batch.total} cards  |  ${batch.linked} linked`, PW / 2, y + 12, { align: 'center' })
      y += 22

      for (let i = 0; i < batchCards.length; i++) {
        const card = batchCards[i]
        const col = i % 2
        const cx = margin + col * (CW + pairGap)
        if (col === 0 && i > 0) {
          y += CH + rowGap
          if (y + CH > 287 - margin) { doc.addPage(); y = margin }
        }

        doc.setFillColor('#1a237e')
        doc.roundedRect(cx, y, CW, CH, 3, 3, 'F')
        doc.setFontSize(CH * 0.09); doc.setFont('helvetica', 'bold'); doc.setTextColor('#c8a84b')
        doc.text('VOCHUS', cx + CW * 0.05, y + CH * 0.16)
        doc.setFontSize(CH * 0.07); doc.setTextColor('#ffffffaa')
        doc.text('EASY SAVE', cx + CW - CW * 0.05, y + CH * 0.16, { align: 'right' })
        doc.setFontSize(CH * 0.1); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff')
        doc.text(card.serial, cx + CW / 2, y + CH * 0.55, { align: 'center', charSpace: 1.2 })
        const sc = card.status === 'Linked' ? '#00c853' : '#e67e22'
        doc.setFillColor(sc)
        doc.roundedRect(cx + CW / 2 - 10, y + CH * 0.64, 20, 5, 1, 1, 'F')
        doc.setFontSize(CH * 0.07); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff')
        doc.text(card.status, cx + CW / 2, y + CH * 0.685, { align: 'center' })
        if (card.customerName) {
          doc.setFontSize(CH * 0.065); doc.setFont('helvetica', 'normal'); doc.setTextColor('#ffffffcc')
          doc.text(card.customerName, cx + CW / 2, y + CH * 0.8, { align: 'center' })
        }
        doc.setFontSize(CH * 0.065); doc.setTextColor('#ffffff88')
        doc.text(`EXP: ${fmt(card.expiryDate)}`, cx + CW * 0.05, y + CH * 0.92)
      }

      doc.save(`${batch.batchName.replace(/\s+/g, '_')}_cards.pdf`)
    } catch {
      toast('The PDF wasn’t created. Check your connection and try again.', 'error')
    } finally {
      setPdfBatch('')
    }
  }

  function openUnlink(c: CardRow) { setUnlinkError(''); setUnlinkTarget(c) }

  async function unlink() {
    if (!unlinkTarget) return
    setUnlinkBusy(true); setUnlinkError('')
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(unlinkTarget.serial)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink' }),
      })
      if (!res.ok) { setUnlinkError(await errorOf(res, 'The card wasn’t unlinked. Try again.')); return }
      toast(`Card ${unlinkTarget.serial} is unlinked`, 'success')
      setUnlinkTarget(null)
      load()
    } catch {
      setUnlinkError('No connection. Check your internet and try again.')
    } finally {
      setUnlinkBusy(false)
    }
  }

  function openLink(c: CardRow) {
    setLinkCard(c); setLinkStep('pick'); setPicked(null); setCustSearch(''); setHits([]); setHitsFailed(false); setLinkError('')
  }

  function closeLink() {
    if (linkBusy) return
    setLinkCard(null); setPicked(null)
  }

  async function relink() {
    if (!linkCard || !picked) return
    setLinkBusy(true); setLinkError('')
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(linkCard.serial)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: picked.id }),
      })
      if (!res.ok) { setLinkError(await errorOf(res, 'The card wasn’t linked. Try again.')); return }
      toast(`Card ${linkCard.serial} is now linked to ${picked.name}`, 'success')
      setLinkCard(null); setPicked(null)
      load()
    } catch {
      setLinkError('No connection. Check your internet and try again.')
    } finally {
      setLinkBusy(false)
    }
  }

  const linkedPct = pct(counts.Linked, counts.All)

  return (
    <>
      <PageHeader
        title="Cards"
        sub={loading && !cards.length ? 'Loading…' : failed && !cards.length ? 'Member cards and the batches they were printed in.' : `${counts.All.toLocaleString('en-NG')} member card${counts.All === 1 ? '' : 's'} in ${batches.length} batch${batches.length === 1 ? '' : 'es'}`}
        actions={<Link href="/superadmin/cards/generate" className="btn btn-green"><Icons.add size={18} aria-hidden="true" /> Generate cards</Link>}
      />

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-lbl">Total cards</div>
          <div className="stat-val">{loading && !cards.length ? <span className="skel cs-stat-skel" /> : counts.All.toLocaleString('en-NG')}</div>
          <div className="stat-sub">{batches.length} batch{batches.length === 1 ? '' : 'es'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Linked to a customer</div>
          <div className="stat-val">{loading && !cards.length ? <span className="skel cs-stat-skel" /> : counts.Linked.toLocaleString('en-NG')}</div>
          <div className="stat-sub">{linkedPct}% of all cards</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Not linked yet</div>
          <div className="stat-val">{loading && !cards.length ? <span className="skel cs-stat-skel" /> : counts.Unlinked.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Waiting for an agent to link them</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Blocked</div>
          <div className={`stat-val${counts.Blocked ? ' red' : ''}`}>{loading && !cards.length ? <span className="skel cs-stat-skel" /> : counts.Blocked.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Can’t be used</div>
        </div>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Card views">
        <button type="button" role="tab" id="cs-tab-batches" aria-controls="cs-panel-batches" aria-selected={tab === 'batches'}
          className={`tab${tab === 'batches' ? ' active' : ''}`} onClick={() => setTab('batches')}>
          Batches <span className="cs-tab-count">{batches.length}</span>
        </button>
        <button type="button" role="tab" id="cs-tab-cards" aria-controls="cs-panel-cards" aria-selected={tab === 'cards'}
          className={`tab${tab === 'cards' ? ' active' : ''}`} onClick={() => setTab('cards')}>
          All cards <span className="cs-tab-count">{cards.length}</span>
        </button>
      </div>

      {tab === 'batches' && (
        <section className="card" id="cs-panel-batches" role="tabpanel" aria-labelledby="cs-tab-batches">
          {loading && !batches.length ? <TableSkeleton rows={5} cols={6} />
            : failed ? <LoadError what="card batches" onRetry={load} />
            : batches.length === 0 ? (
              <Empty icon="qr" title="No card batches yet" text="Generate a batch of member cards to print and hand to agents."
                action={<Link href="/superadmin/cards/generate" className="btn btn-green">Generate cards</Link>} />
            ) : (
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Batch</th><th>Created</th><th>Expires</th>
                      <th className="num">Cards</th><th className="num">Linked</th>
                      <th>Linked so far</th><th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(b => {
                      const p = pct(b.linked, b.total)
                      return (
                        <tr key={b.batchId}>
                          <td>
                            <span className="td-name ui-block">{b.batchName}</span>
                            <span className="td-sub ui-block cs-mono" title={b.batchId}>{b.batchId.slice(0, 8)}…</span>
                          </td>
                          <td data-label="Created">{shortDate(b.createdAt)}</td>
                          <td data-label="Expires">{shortDate(b.expiryDate)}</td>
                          <td className="num" data-label="Cards">{b.total.toLocaleString('en-NG')}</td>
                          <td className="num" data-label="Linked">{b.linked.toLocaleString('en-NG')}</td>
                          <td data-label="Linked so far">
                            <div className="cs-progress">
                              <div className="comm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`${p}% of ${b.batchName} linked`}>
                                <div className="comm-fill" style={{ width: `${p}%` }} />
                              </div>
                              <span>{p}%</span>
                            </div>
                          </td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => { setBatchFilter(b.batchId); setStatusFilter('All'); setSearch(''); setTab('cards') }}>View cards</button>
                              <button type="button" className="btn btn-sm btn-soft" disabled={pdfBatch === b.batchId} onClick={() => downloadBatchPDF(b)}>
                                <Icons.download size={16} aria-hidden="true" /> {pdfBatch === b.batchId ? 'Preparing…' : 'PDF'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {tab === 'cards' && (
        <section id="cs-panel-cards" role="tabpanel" aria-labelledby="cs-tab-cards">
          <div className="toolbar">
            <SearchField value={search} onChange={setSearch} placeholder="Serial, customer or agent" label="Search cards" />
            <Segmented<StatusFilter> label="Filter by status" value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'All', label: 'All', count: failed && !cards.length ? undefined : counts.All },
              { value: 'Linked', label: 'Linked', count: failed && !cards.length ? undefined : counts.Linked },
              { value: 'Unlinked', label: 'Not linked', count: failed && !cards.length ? undefined : counts.Unlinked },
              { value: 'Blocked', label: 'Blocked', count: failed && !cards.length ? undefined : counts.Blocked },
            ]} />
            <label className="cs-select">
              <span className="sr-only">Filter by batch</span>
              <select className="a-input" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
                <option value="All">All batches</option>
                {batches.map(b => <option key={b.batchId} value={b.batchId}>{b.batchName}</option>)}
              </select>
            </label>
            {filtering && <button type="button" className="btn btn-sm btn-outline" onClick={clearFilters}>Clear filters</button>}
          </div>

          <div className="card">
            {loading && !cards.length ? <TableSkeleton rows={8} cols={6} />
              : failed ? <LoadError what="cards" onRetry={load} />
              : cards.length === 0 ? (
                <Empty icon="card" title="No cards yet" text="Cards show here once you’ve generated a batch."
                  action={<Link href="/superadmin/cards/generate" className="btn btn-green">Generate cards</Link>} />
              ) : filteredCards.length === 0 ? (
                <Empty icon="search" title="No cards match these filters"
                  text={batchFilter !== 'All' ? `Nothing in ${batchName(batchFilter)} matches. Try another status or clear the filters.` : 'Check the serial, or try another status.'}
                  action={<button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>} />
              ) : (
                <>
                  <p className="cs-count" aria-live="polite">{filteredCards.length.toLocaleString('en-NG')} card{filteredCards.length === 1 ? '' : 's'}</p>
                  <div className="tbl-wrap tbl-stack">
                    <table>
                      <thead>
                        <tr>
                          <th>Serial</th><th>Batch</th><th>Status</th><th>Customer</th>
                          <th>Agent</th><th>Linked on</th><th>Expires</th><th><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map(c => (
                          <tr key={c.id}>
                            <td><span className="cs-serial">{c.serial}</span></td>
                            <td data-label="Batch">{c.batchName}</td>
                            <td data-label="Status"><StatusBadge status={c.status} /></td>
                            <td data-label="Customer">
                              {c.customerName
                                ? <span><span className="td-name ui-block">{c.customerName}</span><span className="td-sub ui-block">{c.customerId}</span></span>
                                : <span className="cs-muted">None</span>}
                            </td>
                            <td data-label="Agent">{c.agentName ?? <span className="cs-muted">None</span>}</td>
                            <td data-label="Linked on">{c.linkedAt ? shortDate(c.linkedAt) : <span className="cs-muted">Not linked</span>}</td>
                            <td data-label="Expires">{shortDate(c.expiryDate)}</td>
                            <td>
                              <div className="a-row-actions">
                                {c.status === 'Unlinked' && <button type="button" className="btn btn-sm btn-outline" onClick={() => openLink(c)}>Link to a customer</button>}
                                {c.status === 'Linked' && (
                                  <RowMenu label={`Actions for card ${c.serial}`} items={[
                                    { label: 'Move to another customer', onSelect: () => openLink(c) },
                                    { label: 'Unlink card', danger: true, onSelect: () => openUnlink(c) },
                                  ]} />
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pageSize={PAGE_SIZE} total={filteredCards.length} onPage={setPage} />
                </>
              )}
          </div>
        </section>
      )}

      {unlinkTarget && (
        <ConfirmModal
          title={`Unlink card ${unlinkTarget.serial}?`}
          body={<>
            <p>This removes the card from <strong>{unlinkTarget.customerName ?? 'its customer'}</strong>{unlinkTarget.customerId ? ` (${unlinkTarget.customerId})` : ''}{unlinkTarget.agentName ? `, a customer of agent ${unlinkTarget.agentName}` : ''}.</p>
            <p className="dlg-note">Their savings and plans don’t change. The card goes back to not linked, so it can be linked to the right person. This is recorded in the audit log.</p>
          </>}
          confirmLabel="Unlink card" danger
          busy={unlinkBusy} error={unlinkError}
          onConfirm={unlink} onClose={() => { if (!unlinkBusy) setUnlinkTarget(null) }}
        />
      )}

      {linkCard && linkStep === 'pick' && (
        <Modal icon="card"
          title={linkCard.status === 'Linked' ? `Move card ${linkCard.serial}` : `Link card ${linkCard.serial}`}
          sub={linkCard.customerName ? `Linked now to ${linkCard.customerName}${linkCard.customerId ? ` (${linkCard.customerId})` : ''}` : 'Find the customer this card belongs to.'}
          onClose={closeLink}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={closeLink}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={!picked} onClick={() => { setLinkError(''); setLinkStep('confirm') }}>Continue</button>
          </>}>
          <SearchField value={custSearch} onChange={v => { setCustSearch(v); setPicked(null) }} placeholder="Name, customer ID or phone" label="Search customers" />
          <div className="cs-picker" aria-live="polite">
            {custQ.length < 2 ? <p className="a-hint">Type at least 2 characters to search.</p>
              : hitsLoading ? <TableSkeleton rows={3} cols={2} />
              : hitsFailed ? <LoadError what="customers" onRetry={searchCustomers} />
              : hits.length === 0 ? <Empty icon="search" title={`No customers match “${custQ}”`} text="Check the spelling, or search by customer ID or phone number." />
              : (
                <div className="rows" role="group" aria-label="Customers">
                  {hits.map(h => {
                    const current = h.customerId === linkCard.customerId
                    return (
                      <button key={h.id} type="button" className="row cs-pick" aria-pressed={picked?.id === h.id} disabled={current}
                        onClick={() => setPicked(h)}>
                        <Avatar name={h.name} photoUrl={h.photoUrl} />
                        <span className="row-main">
                          <span className="row-title ui-block">{h.name}</span>
                          <span className="row-sub ui-block">{h.customerId} · {h.phone}{h.agentName ? ` · ${h.agentName}` : ''}</span>
                        </span>
                        <span className="row-end">
                          {current ? <span className="bdg bdg-grey">Has this card</span>
                            : picked?.id === h.id ? <span className="cs-pick-tick"><Icons.check size={18} aria-hidden="true" /></span> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            {hits.length === 20 && !hitsLoading && !hitsFailed && <p className="a-hint">Showing the first 20 matches. Search for more detail to narrow it down.</p>}
          </div>
        </Modal>
      )}

      {linkCard && linkStep === 'confirm' && picked && (
        <ConfirmModal icon="card"
          title={linkCard.status === 'Linked' ? `Move card ${linkCard.serial} to ${picked.name}?` : `Link card ${linkCard.serial} to ${picked.name}?`}
          body={<>
            {linkCard.customerName
              ? <p>The card moves from <strong>{linkCard.customerName}</strong>{linkCard.customerId ? ` (${linkCard.customerId})` : ''} to <strong>{picked.name}</strong> ({picked.customerId}).</p>
              : <p>The card will belong to <strong>{picked.name}</strong> ({picked.customerId}).</p>}
            <p className="dlg-note">It’s assigned to their agent{picked.agentName ? `, ${picked.agentName}` : ''}. Savings and plans don’t move with the card. This is recorded in the audit log.</p>
          </>}
          confirmLabel={linkCard.status === 'Linked' ? 'Move card' : 'Link card'}
          busy={linkBusy} error={linkError}
          onConfirm={relink}
          onClose={() => { if (!linkBusy) setLinkStep('pick') }}
        />
      )}

      {toastNode}
    </>
  )
}
