'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'
import { CUSTOMER_NAV } from '@/components/nav-items'

type Tx = {
  id: string; ref: string; type: string; amount: number
  method: string; status: string; createdAt: string
  planGoal?: string | null
  cadence?: string | null
  note?: string
}

const TYPE_META: Record<string, { icon: string; label: string; color: string; sign: string }> = {
  saving:        { icon: '💰', label: 'Saving',      color: '#1a6b3a', sign: '+' },
  redemption:    { icon: '💸', label: 'Redemption',  color: '#c0392b', sign: '−' },
  disbursement:  { icon: '🏦', label: 'Disbursement',color: '#1a5fa8', sign: '+' },
  repayment:     { icon: '🔄', label: 'Repayment',   color: '#c8841a', sign: '−' },
  enrolment:     { icon: '📋', label: 'Enrolment',   color: '#6b8070', sign: '' },
  wallet_funding:{ icon: '💼', label: 'Top-up',      color: '#1a5fa8', sign: '+' },
}

function meta(type: string) {
  return TYPE_META[type] ?? { icon: '📊', label: type, color: '#6b8070', sign: '' }
}

function groupByDate(txs: Tx[]) {
  const groups: { label: string; items: Tx[] }[] = []
  const map = new Map<string, Tx[]>()
  for (const tx of txs) {
    const d = new Date(tx.createdAt)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    let label: string
    if (d.toDateString() === today.toDateString()) label = 'Today'
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday'
    else label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    if (!map.has(label)) { map.set(label, []); groups.push({ label, items: [] }) }
    map.get(label)!.push(tx)
  }
  for (const g of groups) g.items = map.get(g.label)!
  return groups
}

function downloadReceipt(tx: Tx) {
  const m = meta(tx.type)
  const date = new Date(tx.createdAt)
  const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const W = 420, H = 620
  const canvas = document.createElement('canvas')
  canvas.width = W * 2; canvas.height = H * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Header band
  const grad = ctx.createLinearGradient(0, 0, W, 80)
  grad.addColorStop(0, '#071a0e')
  grad.addColorStop(1, '#0e4d24')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(0, 0, W, 80, [0, 0, 0, 0])
  ctx.fill()

  // Logo circle
  ctx.fillStyle = '#1DC96A'
  ctx.beginPath(); ctx.arc(W / 2, 36, 22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('V', W / 2, 43)

  // Brand
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 13px sans-serif'
  ctx.fillText('Vochus Easy Save', W / 2, 66)
  ctx.font = '10px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,.55)'
  ctx.fillText('Official Payment Receipt', W / 2, 78)

  // Status badge
  const statusColor = tx.status === 'completed' ? '#1a6b3a' : tx.status === 'pending' ? '#b45309' : '#c0392b'
  const statusBg = tx.status === 'completed' ? '#e8f5ee' : tx.status === 'pending' ? '#fffbeb' : '#fef2f2'
  ctx.fillStyle = statusBg
  roundRect(ctx, W / 2 - 38, 92, 76, 22, 11)
  ctx.fillStyle = statusColor
  ctx.font = 'bold 11px sans-serif'
  ctx.fillText(tx.status.toUpperCase(), W / 2, 107)

  // Amount
  ctx.fillStyle = m.color
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText(`${m.sign}₦${tx.amount.toLocaleString()}`, W / 2, 160)

  ctx.fillStyle = '#9ca3af'
  ctx.font = '11px sans-serif'
  ctx.fillText(m.label + ' Transaction', W / 2, 178)

  // Divider
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.moveTo(24, 196); ctx.lineTo(W - 24, 196); ctx.stroke()
  ctx.setLineDash([])

  // Detail rows
  const rows: [string, string][] = [
    ['Reference', tx.ref],
    ['Date', dateStr],
    ['Time', timeStr],
    ['Method', tx.method || '—'],
    ['Type', m.label],
    ...(tx.planGoal ? [['Plan', tx.planGoal]] : []),
    ['Status', tx.status],
  ]

  ctx.textAlign = 'left'
  rows.forEach(([label, value], i) => {
    const y = 222 + i * 36
    ctx.fillStyle = '#9ca3af'
    ctx.font = '11px sans-serif'
    ctx.fillText(label, 32, y)
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 12px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(value, W - 32, y)
    ctx.textAlign = 'left'
    if (i < rows.length - 1) {
      ctx.strokeStyle = '#f3f4f6'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(32, y + 10); ctx.lineTo(W - 32, y + 10); ctx.stroke()
    }
  })

  // Footer
  ctx.fillStyle = '#f0faf4'
  roundRect(ctx, 20, H - 90, W - 40, 60, 10)
  ctx.fillStyle = '#1a6b3a'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Keep this receipt as proof of payment', W / 2, H - 62)
  ctx.fillStyle = '#6b7280'
  ctx.font = '10px sans-serif'
  ctx.fillText('easysave.vochusglobalservices.co.uk', W / 2, H - 44)
  ctx.fillStyle = '#9ca3af'
  ctx.font = '9px sans-serif'
  ctx.fillText(`Generated ${dateStr} at ${timeStr}`, W / 2, H - 26)

  const dataUrl = canvas.toDataURL('image/png')
  const filename = `vochus-receipt-${tx.ref.slice(0, 16)}.png`
  const w = window as any

  if (w.__vochusCanSaveReceipt && w.VochusSaveReceipt) {
    w.VochusSaveReceipt.postMessage(JSON.stringify({ data: dataUrl, filename }))
    return
  }

  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
}

export default function TransactionsPage() {
  const router = useRouter()
  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [cadenceFilter, setCadenceFilter] = useState<'all' | 'daily' | 'weekly'>('all')
  const [selected, setSelected] = useState<Tx | null>(null)

  useEffect(() => {
    fetch('/api/customer/transactions')
      .then(r => { if (r.status === 401) { router.push('/customer/login'); return null } return r.json() })
      .then(d => { if (d?.transactions) setTxs(d.transactions) })
      .finally(() => setLoading(false))
  }, [])

  let filtered = filter === 'all' ? txs : txs.filter(t => t.type === filter)
  filtered = cadenceFilter === 'all' ? filtered : filtered.filter(t => t.cadence === cadenceFilter)
  const groups = groupByDate(filtered)

  const sm = selected ? meta(selected.type) : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, height: 56, zIndex: 200,
        background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,.3)',
      }}>
        <button onClick={() => router.push('/customer/dashboard')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Transaction History</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{txs.length} total transactions</div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Type filter chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'saving', label: '💰 Savings' },
            { key: 'redemption', label: '💸 Redemptions' },
            { key: 'disbursement', label: '🏦 Loans' },
            { key: 'repayment', label: '🔄 Repayments' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              flexShrink: 0, padding: '7px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              background: filter === f.key ? 'var(--g)' : 'var(--card)',
              color: filter === f.key ? '#fff' : 'var(--mu)',
              border: filter === f.key ? 'none' : '1px solid var(--br)',
            } as React.CSSProperties}>{f.label}</button>
          ))}
        </div>

        {/* Cadence filter chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
          {[
            { key: 'all', label: 'All Types' },
            { key: 'daily', label: '📅 Daily' },
            { key: 'weekly', label: '📆 Weekly' },
          ].map(f => (
            <button key={f.key} onClick={() => setCadenceFilter(f.key as any)} style={{
              flexShrink: 0, padding: '7px 14px', borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              background: cadenceFilter === f.key ? 'var(--g)' : 'var(--card)',
              color: cadenceFilter === f.key ? '#fff' : 'var(--mu)',
              border: cadenceFilter === f.key ? 'none' : '1px solid var(--br)',
            } as React.CSSProperties}>{f.label}</button>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--mu)', fontSize: 13 }}>Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>No transactions found</div>
          </div>
        )}

        {groups.map(group => (
          <div key={group.label}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mu)', letterSpacing: .5, textTransform: 'uppercase', padding: '10px 0 6px' }}>
              {group.label}
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
              {group.items.map((tx, i) => {
                const m = meta(tx.type)
                const isLast = i === group.items.length - 1
                return (
                  <div key={tx.id} onClick={() => setSelected(tx)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                    borderBottom: isLast ? 'none' : '1px solid var(--br)',
                    cursor: 'pointer',
                  }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{m.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mu)', marginTop: 2 }}>
                        {tx.method} · {new Date(tx.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {tx.amount > 0 ? (
                        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: m.color }}>
                          {m.sign}₦{tx.amount.toLocaleString()}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mu)' }}>—</div>
                      )}
                      <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 2, fontFamily: 'monospace' }}>
                        {tx.ref.length > 12 ? tx.ref.slice(0, 12) + '…' : tx.ref}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Transaction Detail Sheet */}
      {selected && sm && (
        <>
          <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300 }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: 'var(--card)', borderRadius: '20px 20px 0 0',
            padding: '0 0 40px',
            boxShadow: '0 -8px 40px rgba(0,0,0,.2)',
            animation: 'slideUp .25s ease',
          }}>
            <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:none}}`}</style>

            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--br)' }} />
            </div>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 16px' }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Transaction Detail</div>
              <button onClick={() => setSelected(null)} style={{ background: 'var(--bg)', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {/* Amount block */}
            <div style={{ margin: '0 20px 20px', background: 'var(--bg)', borderRadius: 14, padding: '18px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>{sm.icon}</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 28, fontWeight: 900, color: sm.color }}>
                {sm.sign}₦{selected.amount.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 4 }}>{sm.label} Transaction</div>
              <div style={{ marginTop: 8 }}>
                <span style={{
                  display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: selected.status === 'completed' ? '#e8f5ee' : selected.status === 'pending' ? '#fffbeb' : '#fef2f2',
                  color: selected.status === 'completed' ? '#1a6b3a' : selected.status === 'pending' ? '#b45309' : '#c0392b',
                }}>
                  {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                </span>
              </div>
            </div>

            {/* Details */}
            <div style={{ margin: '0 20px 20px' }}>
              {[
                ['Reference', selected.ref, true],
                ['Date', new Date(selected.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
                ['Time', new Date(selected.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })],
                ['Payment Method', selected.method || '—'],
                ['Type', sm.label],
                ...(selected.planGoal ? [['Savings Plan', selected.planGoal]] : []),
                ...(selected.note ? [['Note', selected.note]] : []),
              ].map(([label, value, mono], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '11px 0', borderBottom: '1px solid var(--br)' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>{label}</div>
                  <div style={{ fontWeight: 700, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 12.5 } as React.CSSProperties}>{value}</div>
                </div>
              ))}
            </div>

            {/* Download button */}
            <div style={{ padding: '0 20px' }}>
              <button onClick={() => downloadReceipt(selected)} style={{
                width: '100%', padding: 15,
                background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
                border: 'none', borderRadius: 13, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: 800, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                ⬇️ Download Receipt
              </button>
            </div>
          </div>
        </>
      )}

      <BottomNav items={CUSTOMER_NAV} />
    </div>
  )
}
