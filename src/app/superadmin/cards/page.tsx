'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusBadge(s: string) {
  const map: Record<string, [string, string]> = {
    Linked: ['#dcfce7', '#16a34a'],
    Unlinked: ['#fef3c7', '#d97706'],
    Blocked: ['#fee2e2', '#dc2626'],
  }
  const [bg, color] = map[s] ?? ['#f1f5f9', '#64748b']
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: bg, color }}>{s}</span>
}

export default function CardManagementPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'batches' | 'cards'>('batches')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [batchFilter, setBatchFilter] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/cards/batches')
    if (res.ok) {
      const d = await res.json()
      setBatches(d.batches ?? [])
      setCards(d.cards ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalCards = cards.length
  const linked = cards.filter(c => c.status === 'Linked').length
  const unlinked = cards.filter(c => c.status === 'Unlinked').length

  const filteredCards = cards.filter(c => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false
    if (batchFilter !== 'All' && c.batchId !== batchFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.serial.toLowerCase().includes(q) ||
        (c.customerName ?? '').toLowerCase().includes(q) ||
        (c.agentName ?? '').toLowerCase().includes(q)
    }
    return true
  })

  async function downloadBatchPDF(batch: Batch) {
    const batchCards = cards.filter(c => c.batchId === batch.batchId)
    if (!batchCards.length) return
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
  }

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Card Management</h1>
          <p>Track generated batches and card activation status</p>
        </div>
        <Link href="/superadmin/cards/generate" style={{ padding: '10px 18px', background: 'var(--accent)', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>+ Generate Cards</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { icon: '💳', label: 'Total Cards', value: loading ? '…' : totalCards, color: 'var(--blue)', sub: `${batches.length} batch${batches.length !== 1 ? 'es' : ''}` },
          { icon: '✅', label: 'Linked / Activated', value: loading ? '…' : linked, color: 'var(--green)', sub: `${totalCards ? ((linked / totalCards) * 100).toFixed(0) : 0}% activation rate` },
          { icon: '🟡', label: 'Unlinked', value: loading ? '…' : unlinked, color: '#e67e22', sub: 'Awaiting customer link' },
        ].map(({ icon, label, value, color, sub }) => (
          <div key={label} className="stat">
            <span className="stat-ic">{icon}</span>
            <div className="stat-lbl">{label}</div>
            <div className="stat-val" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {(['batches', 'cards'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 24px', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -2, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--accent)' : 'var(--text2)',
            cursor: 'pointer', fontSize: 14,
          }}>
            {t === 'batches' ? `Batches (${batches.length})` : `All Cards (${cards.length})`}
          </button>
        ))}
      </div>

      {/* Batches tab */}
      {tab === 'batches' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch Name</th>
                  <th>Created</th>
                  <th>Expiry</th>
                  <th>Total</th>
                  <th>Linked</th>
                  <th>Unlinked</th>
                  <th>Activation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Loading…</td></tr>
                ) : batches.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No batches yet — <Link href="/superadmin/cards/generate" style={{ color: 'var(--accent)' }}>Generate cards</Link></td></tr>
                ) : batches.map(b => (
                  <tr key={b.batchId}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{b.batchName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{b.batchId.slice(0, 8)}…</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{fmt(b.createdAt)}</td>
                    <td style={{ fontSize: 13 }}>{fmt(b.expiryDate)}</td>
                    <td style={{ fontWeight: 700 }}>{b.total}</td>
                    <td style={{ color: '#16a34a', fontWeight: 600 }}>{b.linked}</td>
                    <td style={{ color: '#d97706', fontWeight: 600 }}>{b.unlinked}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', minWidth: 60 }}>
                          <div style={{ height: '100%', borderRadius: 3, background: 'var(--green)', width: `${b.total ? (b.linked / b.total) * 100 : 0}%`, transition: 'width .3s' }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', minWidth: 28 }}>{b.total ? ((b.linked / b.total) * 100).toFixed(0) : 0}%</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setBatchFilter(b.batchId); setTab('cards') }} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>View Cards</button>
                        <button onClick={() => downloadBatchPDF(b)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>PDF</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards tab */}
      {tab === 'cards' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '16px 20px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
            <input
              className="a-input"
              placeholder="Search serial, customer, agent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, maxWidth: 280 }}
            />
            <select className="a-input" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              <option>Linked</option>
              <option>Unlinked</option>
              <option>Blocked</option>
            </select>
            <select className="a-input" style={{ width: 180 }} value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
              <option value="All">All Batches</option>
              {batches.map(b => <option key={b.batchId} value={b.batchId}>{b.batchName}</option>)}
            </select>
            {(search || statusFilter !== 'All' || batchFilter !== 'All') && (
              <button onClick={() => { setSearch(''); setStatusFilter('All'); setBatchFilter('All') }} style={{ padding: '9px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text3)' }}>Clear</button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>{filteredCards.length} cards</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Agent</th>
                  <th>Linked Date</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Loading…</td></tr>
                ) : filteredCards.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>No cards match filter</td></tr>
                ) : filteredCards.map(c => (
                  <tr key={c.id}>
                    <td><span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>{c.serial}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{c.batchName}</td>
                    <td>{statusBadge(c.status)}</td>
                    <td>
                      {c.customerName
                        ? <div><div style={{ fontSize: 13, fontWeight: 600 }}>{c.customerName}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.customerId}</div></div>
                        : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text2)' }}>{c.agentName ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{c.linkedAt ? fmt(c.linkedAt) : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{fmt(c.expiryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
