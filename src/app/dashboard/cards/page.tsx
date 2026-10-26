'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface LinkedCard {
  id: string
  serial: string
  status: string
  batchName: string
  expiryDate: string
  customer: { firstName: string; lastName: string; customerId: string } | null
  linkedAt: string | null
}

export default function CardsPage() {
  const router = useRouter()
  const [cards, setCards] = useState<LinkedCard[]>([])
  const [loading, setLoading] = useState(true)
  const [serialInput, setSerialInput] = useState('')
  const [serialError, setSerialError] = useState('')

  // QR scanner state
  const [qrScanActive, setQrScanActive] = useState(false)
  const [qrStreamReady, setQrStreamReady] = useState(false)
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrAnimRef = useRef<number>(0)

  useEffect(() => {
    fetch('/api/cards')
      .then(r => r.json())
      .then(d => { setCards(d.cards ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function openSerial(raw?: string) {
    const s = (raw ?? serialInput).trim()
    if (!s) { setSerialError('Enter a card serial'); return }
    setSerialError('')
    // QR payload may be a URL — pull the trailing path segment
    let serial = s
    try {
      const u = new URL(s)
      const parts = u.pathname.split('/').filter(Boolean)
      serial = parts[parts.length - 1] ?? s
    } catch { /* not a URL, use raw */ }
    router.push(`/dashboard/cards/${encodeURIComponent(serial)}`)
  }

  async function startQrScan() {
    setQrError('')
    setQrStreamReady(false)
    setQrScanActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      qrStreamRef.current = stream
      setQrStreamReady(true)
    } catch {
      setQrError('Camera access denied — enter the serial manually instead')
      setQrScanActive(false)
    }
  }

  function stopQrScan() {
    cancelAnimationFrame(qrAnimRef.current)
    qrStreamRef.current?.getTracks().forEach(t => t.stop())
    qrStreamRef.current = null
    setQrStreamReady(false)
    setQrScanActive(false)
  }

  useEffect(() => {
    if (!qrStreamReady || !qrVideoRef.current || !qrStreamRef.current) return
    const video = qrVideoRef.current
    video.srcObject = qrStreamRef.current
    video.setAttribute('playsinline', 'true')
    video.muted = true
    video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    let running = true

    function tick() {
      if (!running) return
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        import('jsqr').then(({ default: jsQR }) => {
          const code = jsQR(imageData.data, imageData.width, imageData.height)
          if (code?.data) {
            stopQrScan()
            openSerial(code.data)
          }
        })
      }
      qrAnimRef.current = requestAnimationFrame(tick)
    }
    qrAnimRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(qrAnimRef.current) }
  }, [qrStreamReady])

  useEffect(() => () => { qrStreamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  return (
    <>
      <div className="page-header">
        <h2>Configure Card</h2>
        <p>Scan a card QR code to link it to a customer</p>
      </div>

      <div className="grid g-2-1" style={{ marginBottom: 18 }}>
        <div className="card" style={{ padding: '28px 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>💳</div>
            <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
              Link a Card
            </div>
            <p style={{ color: 'var(--mu)', fontSize: 13, lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
              Enter a card serial below, or scan the QR code on the card, to assign it to a customer.
            </p>
          </div>

          <label className="flabel" style={{ fontSize: 12 }}>Card Serial</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              className="finput"
              placeholder="e.g. VES-NFC-00841"
              value={serialInput}
              onChange={e => { setSerialInput(e.target.value); setSerialError('') }}
              onKeyDown={e => e.key === 'Enter' && openSerial()}
              style={{ flex: 1 }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => openSerial()}
              className="btn btn-g"
              style={{ whiteSpace: 'nowrap' }}
            >Continue →</button>
          </div>
          {serialError && <div style={{ fontSize: 12, color: '#c0392b' }}>⚠️ {serialError}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 12px', color: 'var(--mu)', fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--br)' }} />
            <span>OR</span>
            <div style={{ flex: 1, height: 1, background: 'var(--br)' }} />
          </div>

          <button
            type="button"
            onClick={startQrScan}
            className="btn btn-out"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <span style={{ fontSize: 18 }}>📷</span> Scan QR Code
          </button>
          {qrError && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 8 }}>⚠️ {qrError}</div>}
          <div style={{ background: 'var(--gl)', border: '1px solid var(--g)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--g)', fontWeight: 600, textAlign: 'center', marginTop: 10 }}>
            💡 The QR code is on the front of each physical card
          </div>
        </div>

        <div className="card">
          <div className="card-title">How It Works</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { n: '1', t: 'Receive a card', d: 'Admin generates and prints membership cards for distribution' },
              { n: '2', t: 'Scan the QR code', d: 'Open your phone camera and point it at the QR code on the card' },
              { n: '3', t: 'Link to customer', d: 'Search for the customer and tap "Link Card" to assign it' },
              { n: '4', t: 'Card is activated', d: 'The customer can now use their card for savings transactions' },
            ].map(({ n, t, d }) => (
              <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--g)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{n}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t}</div>
                  <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 2 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sec-label">My Linked Cards</div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Serial</th><th>Batch</th><th>Customer</th><th>Linked</th><th>Expiry</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>Loading…</td></tr>}
              {!loading && cards.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>No cards linked yet — scan a card QR to get started</td></tr>
              )}
              {!loading && cards.map(c => (
                <tr key={c.id}>
                  <td className="td-mono" style={{ color: 'var(--b)', fontWeight: 600 }}>{c.serial}</td>
                  <td style={{ color: 'var(--mu)', fontSize: 12.5 }}>{c.batchName}</td>
                  <td>
                    {c.customer
                      ? <><div className="td-name">{c.customer.firstName} {c.customer.lastName}</div><div className="td-sub">{c.customer.customerId}</div></>
                      : <span style={{ color: 'var(--mu)' }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--mu)', fontSize: 12.5 }}>
                    {c.linkedAt ? new Date(c.linkedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ color: 'var(--mu)', fontSize: 12.5 }}>
                    {new Date(c.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </td>
                  <td><span className={`bdg ${c.status === 'Linked' ? 'bdg-ok' : c.status === 'Blocked' ? 'bdg-rd' : 'bdg-b'}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {qrScanActive && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📷 Point camera at card QR code</div>
          <div style={{ position: 'relative', width: '100%', maxWidth: 360, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video ref={qrVideoRef} playsInline muted style={{ width: '100%', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 200, height: 200, position: 'relative' }}>
                {[['0','0'],['0','auto'],['auto','0'],['auto','auto']].map(([t,b], i) => (
                  <div key={i} style={{ position: 'absolute', width: 30, height: 30, top: t === '0' ? 0 : undefined, bottom: b === '0' ? 0 : undefined, left: i < 2 ? 0 : undefined, right: i >= 2 ? 0 : undefined, borderTop: t === '0' ? '3px solid #00e676' : undefined, borderBottom: b === '0' ? '3px solid #00e676' : undefined, borderLeft: i < 2 ? '3px solid #00e676' : undefined, borderRight: i >= 2 ? '3px solid #00e676' : undefined }} />
                ))}
              </div>
            </div>
          </div>
          <div style={{ color: '#aaa', fontSize: 13, marginTop: 12, textAlign: 'center' }}>Scanning automatically…</div>
          <button onClick={stopQrScan} style={{ marginTop: 20, padding: '12px 32px', background: '#fff', color: '#111', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
    </>
  )
}
