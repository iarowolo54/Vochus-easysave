'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

type CardInfo = {
  id: string
  serial: string
  status: string
  batchName: string
  expiryDate: string
  customer: { name: string; customerId: string } | null
}

type CustomerResult = {
  id: string
  customerId: string
  firstName: string
  lastName: string
  phone: string
}

export default function CardSetupPage() {
  const params = useParams()
  const router = useRouter()
  const serial = params.serial as string

  const [card, setCard] = useState<CardInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<CustomerResult | null>(null)
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  const [linkError, setLinkError] = useState('')

  useEffect(() => {
    fetch(`/api/cards/${serial}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setCard(d)
      })
      .catch(() => setError('Failed to load card'))
      .finally(() => setLoading(false))
  }, [serial])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const r = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=10`)
      const d = await r.json()
      setResults(d.customers ?? [])
    } catch { setResults([]) }
    finally { setSearching(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 300)
    return () => clearTimeout(t)
  }, [search, doSearch])

  const handleLink = async () => {
    if (!selected) return
    setLinking(true)
    setLinkError('')
    try {
      const r = await fetch(`/api/cards/${serial}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selected.id }),
      })
      const d = await r.json()
      if (!r.ok) { setLinkError(d.error ?? 'Link failed'); return }
      setCard(d)
      setLinked(true)
    } catch { setLinkError('Network error') }
    finally { setLinking(false) }
  }

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--mu)' }}>Loading card…</div>
    )
  }

  if (error) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <button onClick={() => router.push('/dashboard/cards')} style={backLinkStyle}>← Back to Configure Card</button>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Card not found</div>
          <div style={{ color: 'var(--mu)', fontSize: 13.5, marginBottom: 20, lineHeight: 1.6 }}>{error}</div>
          <button className="btn btn-g" onClick={() => router.push('/dashboard/cards')}>Try Another Serial</button>
        </div>
      </div>
    )
  }

  const isAlreadyLinked = card?.status === 'Linked' || linked

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 0' }}>
      <button onClick={() => router.push('/dashboard/cards')} style={backLinkStyle}>← Back to Configure Card</button>

      {/* Card preview */}
      <div style={{
        background: 'linear-gradient(135deg,#0e4d24,#1a6b3a)',
        color: '#fff',
        borderRadius: 16,
        padding: '22px 22px 18px',
        marginBottom: 18,
        boxShadow: '0 10px 30px rgba(14,77,36,.25)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,.08)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -10, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,.05)' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>💳</span>
            <span style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1 }}>VOCHUS EASY SAVE</span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: isAlreadyLinked ? 'rgba(255,255,255,.2)' : 'rgba(255,200,0,.25)',
            color: '#fff', border: '1px solid rgba(255,255,255,.3)',
          }}>{isAlreadyLinked ? '✓ LINKED' : '⏳ UNLINKED'}</span>
        </div>

        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, letterSpacing: 3, marginBottom: 18, position: 'relative' }}>
          {serial}
        </div>

        <div style={{ display: 'flex', gap: 18, fontSize: 11, opacity: .85, position: 'relative' }}>
          <div>
            <div style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Batch</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{card?.batchName ?? '—'}</div>
          </div>
          <div>
            <div style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Expires</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{card?.expiryDate ? new Date(card.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</div>
          </div>
        </div>
      </div>

      {isAlreadyLinked ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 50, marginBottom: 12 }}>✅</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Card Activated</div>
          <div style={{ color: 'var(--mu)', fontSize: 13.5, lineHeight: 1.6, marginBottom: 18 }}>
            This card is linked to <strong style={{ color: 'var(--text)' }}>{card?.customer?.name}</strong>
            {card?.customer?.customerId && <span> · {card.customer.customerId}</span>}
            <br />The customer can now use it for savings transactions.
          </div>
          <button className="btn btn-out" onClick={() => router.push('/dashboard/cards')}>Configure Another Card</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Link to Customer</div>
          <div style={{ color: 'var(--mu)', fontSize: 12.5, marginBottom: 14 }}>Search by name, phone, or customer ID, then tap to select.</div>

          <div style={{ position: 'relative' }}>
            <input
              className="finput"
              type="text"
              placeholder="e.g. Ngozi, 08023404253, or CUS-00012"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null) }}
              style={{ paddingLeft: 38 }}
              autoFocus
            />
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--mu)', fontSize: 16 }}>🔍</span>
          </div>

          {searching && <div style={{ fontSize: 12.5, color: 'var(--mu)', marginTop: 6 }}>Searching…</div>}

          {results.length > 0 && !selected && (
            <div style={{
              border: '1px solid var(--br)',
              borderRadius: 10,
              marginTop: 10,
              maxHeight: 280,
              overflowY: 'auto',
            }}>
              {results.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => { setSelected(c); setResults([]); setSearch('') }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: i < results.length - 1 ? '1px solid var(--br)' : 'none',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--gl)', color: 'var(--g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {(c.firstName[0] ?? '?')}{(c.lastName[0] ?? '')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{c.firstName} {c.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--mu)' }}>{c.customerId} · {c.phone}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searching && search.trim().length > 0 && results.length === 0 && !selected && (
            <div style={{ fontSize: 12.5, color: 'var(--mu)', marginTop: 10, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8 }}>
              No customers match &ldquo;{search}&rdquo;. Try a different search.
            </div>
          )}

          {selected && (
            <div style={{
              padding: 14,
              borderRadius: 12,
              background: '#dcfce7',
              border: '1.5px solid #16a34a',
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {(selected.firstName[0] ?? '?')}{(selected.lastName[0] ?? '')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: '#0e4d24', fontSize: 14.5 }}>{selected.firstName} {selected.lastName}</div>
                <div style={{ fontSize: 12, color: '#1a6b3a' }}>{selected.customerId} · {selected.phone}</div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'rgba(0,0,0,.06)', border: 'none', cursor: 'pointer', color: '#0e4d24', fontSize: 16, width: 28, height: 28, borderRadius: '50%' }}
                title="Choose another"
              >×</button>
            </div>
          )}

          {linkError && (
            <div className="alert alert-rd" style={{ marginTop: 12 }}>🔴 {linkError}</div>
          )}

          <button
            className="btn btn-g"
            onClick={handleLink}
            disabled={!selected || linking}
            style={{ width: '100%', marginTop: 16, opacity: selected && !linking ? 1 : .55 }}
          >
            {linking ? '⏳ Linking…' : selected ? `🔗 Link to ${selected.firstName} ${selected.lastName}` : '🔗 Select a Customer First'}
          </button>
        </div>
      )}
    </div>
  )
}

const backLinkStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--mu)', fontSize: 13, padding: '4px 0', marginBottom: 16,
  display: 'flex', alignItems: 'center', gap: 4,
}
