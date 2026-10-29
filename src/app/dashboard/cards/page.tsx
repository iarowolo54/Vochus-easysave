'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { displayName, formatDate } from '@/lib/format'

interface LinkedCard {
  id: string
  serial: string
  status: string
  batchName: string
  expiryDate: string
  customer: { firstName: string; lastName: string; customerId: string } | null
  linkedAt: string | null
}

const expired = (iso: string) => new Date(iso).getTime() < Date.now()
const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

/** A QR payload may be the card's URL; the serial is its last path segment. */
function serialFrom(raw: string) {
  const s = raw.trim()
  try {
    const parts = new URL(s).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? s
  } catch { return s }
}

export default function CardsPage() {
  const router = useRouter()
  const [cards, setCards] = useState<LinkedCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [serial, setSerial] = useState('')
  const [serialError, setSerialError] = useState('')
  const [query, setQuery] = useState('')

  const [scanning, setScanning] = useState(false)
  const [streamReady, setStreamReady] = useState(false)
  const [scanError, setScanError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef(0)

  useEffect(() => {
    fetch('/api/cards')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setCards(d.cards ?? []))
      .catch(() => { setFailed(true); setCards([]) })
  }, [])

  function open(raw?: string) {
    const s = serialFrom(raw ?? serial)
    if (!s) { setSerialError('Enter the serial printed on the card'); return }
    router.push(`/dashboard/cards/${encodeURIComponent(s)}`)
  }

  async function startScan() {
    setScanError(''); setStreamReady(false); setScanning(true)
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      setStreamReady(true)
    } catch (e) {
      setScanning(false)
      setScanError((e as { name?: string })?.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in your browser or phone settings, or type the serial instead.'
        : 'The camera couldn’t be opened. Type the serial instead.')
    }
  }

  function stopScan() {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setStreamReady(false)
    setScanning(false)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!streamReady || !video || !streamRef.current) return
    video.srcObject = streamRef.current
    video.play().catch(() => {})
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let running = true
    let decode: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null
    import('jsqr').then(m => { decode = m.default })

    const tick = () => {
      if (!running) return
      if (decode && ctx && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = decode(img.data, img.width, img.height)
        if (code?.data) { stopScan(); open(code.data); return }
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(frameRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamReady])

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  const q = query.trim().toLowerCase()
  const shown = (cards ?? []).filter(c => !q || c.serial.toLowerCase().includes(q)
    || (c.customer && (`${c.customer.firstName} ${c.customer.lastName}`.toLowerCase().includes(q) || c.customer.customerId.toLowerCase().includes(q))))

  return (
    <div className="ag-page">
      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head"><h2>Link a card</h2></div>
          <section className="ui-card ag-card-link">
            <span className="ag-topup-icon" aria-hidden="true"><Icons.card size={22} /></span>
            <p className="ui-row-sub">Scan the QR code on the front of a membership card, or type its serial, then choose the customer it belongs to.</p>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={startScan}><Icons.image size={18} aria-hidden="true" /> Scan the QR code</button>
            {scanError && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {scanError}</p>}
            <p className="ag-or"><span>or type it</span></p>
            <div className="ag-card-row">
              <div className="ag-tf-wrap">
                <div className={`ag-tf${serialError ? ' is-invalid' : ''}`}>
                  <label className="ag-tf-label" htmlFor="card-serial">Card serial</label>
                  <input id="card-serial" className="ag-tf-input ag-tf-num" autoCapitalize="characters" autoComplete="off" placeholder="e.g. VES-NFC-00841"
                    value={serial} aria-invalid={serialError ? true : undefined}
                    onChange={e => { setSerial(e.target.value.toUpperCase()); setSerialError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') open() }} />
                </div>
              </div>
              <button type="button" className="ui-btn ui-btn--secondary ag-scan-btn" onClick={() => open()}>Find card</button>
            </div>
            <FieldError id="card-serial-error" message={serialError} />
          </section>
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Your linked cards</h2>{cards && cards.length > 0 && <span className="ui-card-meta">{cards.length}</span>}</div>
          {cards && cards.length > 3 && (
            <div className="ag-search ag-cal-search">
              <Icons.search size={20} aria-hidden="true" />
              <input className="ui-input" type="search" autoComplete="off" placeholder="Serial, customer name or ID" aria-label="Search linked cards" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          )}
          {cards === null ? (
            <ListSkeleton count={3} />
          ) : failed ? (
            <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your cards" text="Check your connection and refresh the page." /></section>
          ) : cards.length === 0 ? (
            <section className="ui-card"><EmptyState icon="card" title="No cards linked yet" text="Cards you link to customers show here." /></section>
          ) : shown.length === 0 ? (
            <section className="ui-card"><EmptyState icon="search" title="No cards match" text="Try another serial or name." /></section>
          ) : (
            <section className="ui-card ui-card--list" aria-label="Linked cards">
              {shown.map(c => {
                const isExpired = expired(c.expiryDate)
                const tag = c.status === 'Blocked' ? ['Blocked', 'ag-crow-tag--due'] : isExpired ? ['Expired', 'ag-crow-tag--due'] : c.status === 'Linked' ? ['Linked', 'ag-crow-tag--ok'] : [c.status, '']
                return (
                  <button key={c.id} type="button" className="ag-crow" onClick={() => router.push(`/dashboard/cards/${encodeURIComponent(c.serial)}`)}>
                    <span className="ag-doc-icon" aria-hidden="true"><Icons.card size={20} /></span>
                    <span className="ag-crow-main">
                      <span className="ag-crow-name">{c.customer ? displayName(`${c.customer.firstName} ${c.customer.lastName}`) : 'Not linked'}</span>
                      <span className="ag-crow-sub"><span className="ag-mono">{c.serial}</span>{c.customer ? ` · ${c.customer.customerId}` : ''}</span>
                      <span className="ag-crow-sub">{c.linkedAt ? `Linked ${formatDate(c.linkedAt)} · ` : ''}{isExpired ? 'Expired' : 'Expires'} {monthYear(c.expiryDate)}</span>
                    </span>
                    <span className="ag-crow-end"><span className={`ag-crow-tag ${tag[1]}`}>{tag[0]}</span></span>
                  </button>
                )
              })}
            </section>
          )}
        </div>
      </div>

      {scanning && (
        <div className="ag-qr" role="dialog" aria-modal="true" aria-label="Scan card QR code">
          <p className="ag-qr-title">Point the camera at the card’s QR code</p>
          <div className="ag-qr-frame">
            <video ref={videoRef} playsInline muted />
            <span className="ag-qr-target" aria-hidden="true" />
          </div>
          <p className="ag-qr-hint">{streamReady ? 'Scanning…' : 'Opening camera…'}</p>
          <button type="button" className="ui-btn ui-btn--secondary ag-qr-cancel" onClick={stopScan}>Cancel</button>
        </div>
      )}
    </div>
  )
}
