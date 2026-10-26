'use client'

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

type ColorScheme = { label: string; bg: string; accent: string; text: string }

const COLOR_SCHEMES: ColorScheme[] = [
  { label: 'Forest', bg: '#0D1C15', accent: '#3FBF80', text: '#FFFFFF' },
  { label: 'Ocean', bg: '#0F1923', accent: '#4A90D9', text: '#FFFFFF' },
  { label: 'Royal', bg: '#1A1017', accent: '#C084FC', text: '#FFFFFF' },
  { label: 'Gold',  bg: '#1C1100', accent: '#F59E0B', text: '#FFFFFF' },
  { label: 'Ruby',  bg: '#1A0A0A', accent: '#EF4444', text: '#FFFFFF' },
  { label: 'Light', bg: '#F8F5EF', accent: '#1A6B4A', text: '#1A1917' },
]

const EXPIRY_PRESETS = [
  { label: '1 Year', years: 1 },
  { label: '2 Years', years: 2 },
  { label: '3 Years', years: 3 },
]

function getExpiryDate(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().slice(0, 10)
}

function generateBatchId(): string {
  return Math.random().toString(36).toUpperCase().slice(2, 6)
}

function generateSerials(batchId: string, quantity: number): string[] {
  return Array.from({ length: quantity }, (_, i) =>
    `VES-${batchId}${String(i + 1).padStart(4, '0')}`
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

function randomCvv(): string {
  return String(Math.floor(Math.random() * 900) + 100)
}

function blend(fgHex: string, bgHex: string, opacity: number): [number, number, number] {
  const [fR, fG, fB] = hexToRgb(fgHex)
  const [bR, bG, bB] = hexToRgb(bgHex)
  return [Math.round(bR + (fR - bR) * opacity), Math.round(bG + (fG - bG) * opacity), Math.round(bB + (fB - bB) * opacity)]
}

function drawCardFront(
  doc: any, x: number, y: number, w: number, h: number,
  serial: string, batchName: string, scheme: ColorScheme, qrDataUrl: string
) {
  const [bgR, bgG, bgB] = hexToRgb(scheme.bg)
  const [acR, acG, acB] = hexToRgb(scheme.accent)
  const [txR, txG, txB] = hexToRgb(scheme.text)
  const [es_r, es_g, es_b] = blend(scheme.text, scheme.bg, 0.55)
  const [lb_r, lb_g, lb_b] = blend(scheme.text, scheme.bg, 0.4)
  const [bn_r, bn_g, bn_b] = blend(scheme.text, scheme.bg, 0.75)
  const [ci_r, ci_g, ci_b] = blend(scheme.accent, scheme.bg, 0.13)

  // Background
  doc.setFillColor(bgR, bgG, bgB)
  doc.roundedRect(x, y, w, h, 4, 4, 'F')

  // Decorative rings — clipped to card bounds
  const sf = doc.internal.scaleFactor
  const ph = doc.internal.pageSize.getHeight()
  doc.saveGraphicsState()
  doc.internal.write(
    `${(x * sf).toFixed(3)} ${((ph - y - h) * sf).toFixed(3)} ${(w * sf).toFixed(3)} ${(h * sf).toFixed(3)} re W n`
  )
  doc.setDrawColor(ci_r, ci_g, ci_b)
  doc.setLineWidth(0.6)
  doc.circle(x + w * 0.62, y + h * 0.45, h * 0.75, 'S')
  doc.setLineWidth(0.5)
  doc.circle(x + w * 0.18, y + h * 0.82, h * 0.55, 'S')
  doc.restoreGraphicsState()

  // VOCHUS — top left
  doc.setTextColor(acR, acG, acB)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(h * 0.19)
  doc.text('VOCHUS', x + w * 0.05, y + h * 0.2)

  // EASY SAVE — top right
  doc.setTextColor(es_r, es_g, es_b)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.09)
  doc.text('EASY SAVE', x + w * 0.95, y + h * 0.15, { align: 'right' })

  // QR box — left center, small
  const qrPad = 1.2
  const qrSize = h * 0.2
  const qrX = x + w * 0.05
  const qrY = y + (h - qrSize) / 2 - h * 0.02
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2, 1.5, 1.5, 'F')
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  }

  // Serial — centered on card
  doc.setTextColor(txR, txG, txB)
  doc.setFont('courier', 'bold')
  doc.setFontSize(h * 0.14)
  doc.text(serial, x + w / 2, y + h * 0.55, { align: 'center', charSpace: 1.2 })

  // Batch name — bottom left (no label)
  doc.setTextColor(bn_r, bn_g, bn_b)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.12)
  const bn = batchName.length > 18 ? batchName.slice(0, 18) + '…' : batchName
  doc.text(bn, x + w * 0.05, y + h * 0.91)

  // MEMBER CARD label — bottom right
  doc.setTextColor(lb_r, lb_g, lb_b)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(h * 0.09)
  doc.text('MEMBER CARD', x + w * 0.95, y + h * 0.8, { align: 'right' })

  // Chip
  const chipW = w * 0.1, chipH = h * 0.1
  doc.setFillColor(acR, acG, acB)
  doc.roundedRect(x + w * 0.95 - chipW, y + h * 0.84, chipW, chipH, 1.2, 1.2, 'F')
}

function drawCardBack(
  doc: any, x: number, y: number, w: number, h: number,
  backText: string, scheme: ColorScheme, cvv: string
) {
  const [acR, acG, acB] = hexToRgb(scheme.accent)

  // Background + border
  doc.setFillColor(242, 239, 233)
  doc.roundedRect(x, y, w, h, 4, 4, 'F')
  doc.setDrawColor(218, 214, 208)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, w, h, 4, 4, 'S')

  // Magnetic stripe (~20% from top, height 22%)
  const stripeY = y + h * 0.2
  const stripeH = h * 0.22
  doc.setFillColor(20, 20, 20)
  doc.rect(x, stripeY, w, stripeH, 'F')

  // Signature panel (starts at ~53%)
  const sigY = y + h * 0.53
  const sigH = h * 0.2
  const sigX = x + w * 0.04
  const cvvW = w * 0.14
  const sigW = w - w * 0.04 * 2 - cvvW - w * 0.02

  // Signature fill + stripes
  doc.setFillColor(232, 228, 222)
  doc.setDrawColor(196, 192, 186)
  doc.setLineWidth(0.15)
  doc.rect(sigX, sigY, sigW, sigH, 'FD')
  // horizontal stripe lines
  doc.setDrawColor(210, 206, 200)
  doc.setLineWidth(0.08)
  let sy = sigY + 1.2
  while (sy < sigY + sigH - 0.5) { doc.line(sigX + 0.5, sy, sigX + sigW - 0.5, sy); sy += 1.5 }
  // label
  doc.setTextColor(170, 166, 160)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.075)
  doc.text('AUTHORISED SIGNATURE', sigX + 2, sigY + sigH - 2)

  // CVV box — number only, unique per card
  const cvvX = sigX + sigW + w * 0.02
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(196, 192, 186)
  doc.setLineWidth(0.15)
  doc.rect(cvvX, sigY, cvvW, sigH, 'FD')
  doc.setTextColor(40, 40, 40)
  doc.setFont('courier', 'bold')
  doc.setFontSize(h * 0.18)
  doc.text(cvv, cvvX + cvvW / 2, sigY + sigH * 0.72, { align: 'center' })

  // Vochus. branding (bottom left)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(h * 0.14)
  doc.setTextColor(26, 25, 23)
  const vw = doc.getTextWidth('Vochus')
  doc.text('Vochus', x + w * 0.04, y + h * 0.92)
  doc.setTextColor(acR, acG, acB)
  doc.text('.', x + w * 0.04 + vw, y + h * 0.92)

  // Back text (bottom right)
  if (backText) {
    const lines = backText.split('\n').filter(Boolean).slice(0, 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(h * 0.085)
    doc.setTextColor(110, 106, 100)
    const lineH = h * 0.115
    lines.forEach((line, i) => {
      doc.text(line, x + w * 0.96, y + h * 0.92 - (lines.length - 1 - i) * lineH, { align: 'right' })
    })
  }
}

type GeneratedCard = { id: string; serial: string }

function CardFront({ batchName, scheme, serial, qrDataUrl }: {
  batchName: string; scheme: ColorScheme; serial: string; qrDataUrl?: string
}) {
  return (
    <div style={{
      aspectRatio: '1.586 / 1', borderRadius: 16, background: scheme.bg,
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      position: 'relative', overflow: 'hidden', width: '100%',
    }}>
      <div style={{ position: 'absolute', width: '120%', height: '120%', borderRadius: '50%', border: `1px solid ${scheme.accent}20`, top: '-20%', right: '-20%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: '80%', height: '80%', borderRadius: '50%', border: `1px solid ${scheme.accent}15`, bottom: '-20%', left: '-5%', pointerEvents: 'none' }} />
      {/* Top row */}
      <div style={{ position: 'absolute', top: '10%', left: '6%', right: '6%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.5, color: scheme.accent }}>VOCHUS</div>
        <div style={{ fontSize: 8, color: `${scheme.text}77`, letterSpacing: 0.8 }}>EASY SAVE</div>
      </div>
      {/* QR left, serial right */}
      <div style={{ position: 'absolute', top: '28%', left: '6%', right: '6%', display: 'flex', alignItems: 'center', gap: '5%' }}>
        <div style={{ width: '28%', aspectRatio: '1', borderRadius: 5, background: '#fff', padding: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {qrDataUrl
            ? <img src={qrDataUrl} style={{ width: '100%', height: '100%', display: 'block' }} alt={serial} />
            : <span style={{ fontSize: 18, opacity: 0.4 }}>▦</span>}
        </div>
      </div>
      {/* Serial — centered */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: 1.5, color: scheme.text, fontWeight: 600 }}>{serial}</span>
      </div>
      {/* Bottom row */}
      <div style={{ position: 'absolute', bottom: '8%', left: '6%', right: '6%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 10, color: `${scheme.text}BB`, fontWeight: 500, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {batchName || 'Batch Name'}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 7, color: `${scheme.text}66`, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>MEMBER CARD</div>
          <div style={{ width: 24, height: 14, borderRadius: 3, background: scheme.accent, opacity: 0.85 }} />
        </div>
      </div>
    </div>
  )
}

function CardBack({ scheme, backText, cvv }: { scheme: ColorScheme; backText: string; cvv: string }) {
  return (
    <div style={{
      aspectRatio: '1.586 / 1', borderRadius: 16, background: '#F2EFE9', border: '1px solid #DDD',
      position: 'relative', overflow: 'hidden', width: '100%',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    }}>
      <div style={{ width: '100%', height: '22%', background: '#1a1a1a', position: 'absolute', top: '20%', left: 0 }} />
      <div style={{ position: 'absolute', top: '52%', left: '5%', right: '5%', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 28, background: 'repeating-linear-gradient(0deg,#e8e4de,#e8e4de 1px,transparent 1px,transparent 5px)', border: '1px solid #ccc', position: 'relative' }}>
          <div style={{ position: 'absolute', bottom: 3, left: 6, fontSize: 6, letterSpacing: 1, color: '#aaa', textTransform: 'uppercase' }}>Authorised Signature</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ccc', padding: '5px 10px', textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#333' }}>{cvv}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '8%', left: '5%', right: '5%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1917' }}>
          Vochus<span style={{ color: scheme.accent }}>.</span>
        </div>
        <div style={{ textAlign: 'right', fontSize: 8, color: '#888', letterSpacing: 0.3, lineHeight: 1.8, whiteSpace: 'pre-line' }}>
          {backText || 'easysave.vochusglobalservices.co.uk'}
        </div>
      </div>
    </div>
  )
}

export default function GenerateCardsPage() {
  const [batchName, setBatchName] = useState('')
  const [schemeIdx, setSchemeIdx] = useState(0)
  const [quantity, setQuantity] = useState(50)
  const [expiryYears, setExpiryYears] = useState(2)
  const [backText, setBackText] = useState('easysave.vochusglobalservices.co.uk\nsupport@vochus.ng')
  const [flipped, setFlipped] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [cards, setCards] = useState<GeneratedCard[]>([])
  const [batchId, setBatchId] = useState('')
  const [generated, setGenerated] = useState(false)

  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [cvvMap, setCvvMap] = useState<Record<string, string>>({})
  const [qrLoading, setQrLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  const scheme = COLOR_SCHEMES[schemeIdx]
  const previewSerial = 'VES-XXXX0001'

  useEffect(() => {
    if (!generated || cards.length === 0) return
    setQrLoading(true)
    const baseUrl = 'https://easysave.vochusglobalservices.co.uk/card/'
    Promise.all(
      cards.map(async c => {
        const dataUrl = await QRCode.toDataURL(`${baseUrl}${c.serial}`, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
        return [c.serial, dataUrl] as [string, string]
      })
    ).then(entries => { setQrMap(Object.fromEntries(entries)); setQrLoading(false) })
     .catch(() => setQrLoading(false))
  }, [generated, cards])

  const handleGenerate = async () => {
    if (!batchName.trim()) { setGenError('Batch name is required'); return }
    if (quantity < 1 || quantity > 500) { setGenError('Quantity must be 1–500'); return }
    setGenError(''); setGenerating(true)
    const bid = generateBatchId()
    const serials = generateSerials(bid, quantity)
    try {
      const r = await fetch('/api/admin/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchName: batchName.trim(), quantity, expiryDate: getExpiryDate(expiryYears), serials, batchId: bid }),
      })
      const d = await r.json()
      if (!r.ok) { setGenError(d.error ?? 'Generation failed'); return }
      setBatchId(d.batchId); setCards(d.cards); setGenerated(true)
      setCvvMap(Object.fromEntries(d.cards.map((c: GeneratedCard) => [c.serial, randomCvv()])))
    } catch { setGenError('Network error') }
    finally { setGenerating(false) }
  }

  const downloadPDF = async () => {
    if (qrLoading || cards.length === 0) return
    setPdfLoading(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

      const PW = 210, PH = 297
      const margin = 10
      const pairGap = 5
      // Fill available width: 2 cards + gap = available
      const CW = (PW - 2 * margin - pairGap) / 2  // ~92.5mm
      const CH = CW / 1.586                          // ~58.3mm
      const startX = margin
      const rowGap = 7
      const slotH = CH + rowGap
      const rowsPerPage = Math.floor((PH - 2 * margin) / slotH)

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]
        const posInPage = i % rowsPerPage

        if (i > 0 && posInPage === 0) doc.addPage()

        const y = margin + posInPage * slotH
        const qr = qrMap[card.serial] ?? ''

        drawCardFront(doc, startX, y, CW, CH, card.serial, batchName, scheme, qr)
        drawCardBack(doc, startX + CW + pairGap, y, CW, CH, backText, scheme, cvvMap[card.serial] ?? randomCvv())
      }

      const filename = `VES-${batchName.replace(/\s+/g, '-')}-${batchId}.pdf`
      doc.save(filename)
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <>
      <style>{`
        .flip-scene { perspective: 900px; width: 100%; }
        .flip-card { position: relative; width: 100%; transform-style: preserve-3d; transition: transform 0.55s cubic-bezier(.4,0,.2,1); }
        .flip-card.flipped { transform: rotateY(180deg); }
        .flip-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        .flip-back-face { transform: rotateY(180deg); }
        .flip-scene-wrap { position: relative; width: 100%; }
        .flip-scene-wrap::before { content: ''; display: block; padding-top: 63%; }
      `}</style>

      <div className="pg-hd">
        <div><h1>Generate Cards</h1><p>Create batches of physical member cards with QR codes</p></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)', gap: 24, alignItems: 'start' }}>

        {/* LEFT: form */}
        <div>
          {!generated ? (
            <>
              <div className="card" style={{ padding: 24, marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>1</span>
                  Batch Setup
                </div>

                <label className="a-label">Batch Name *</label>
                <input className="a-input" type="text" placeholder="e.g. June 2026 Batch"
                  value={batchName} onChange={e => setBatchName(e.target.value)} style={{ marginBottom: 20 }} />

                <label className="a-label" style={{ marginBottom: 10, display: 'block' }}>Color Scheme</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  {COLOR_SCHEMES.map((s, i) => (
                    <div key={s.label} onClick={() => setSchemeIdx(i)} title={s.label}
                      style={{ width: 44, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${s.bg} 60%, ${s.accent})`, cursor: 'pointer', border: schemeIdx === i ? `2.5px solid ${s.accent}` : '2.5px solid transparent', boxShadow: schemeIdx === i ? `0 0 0 2px ${s.accent}55` : 'none', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {schemeIdx === i && <span style={{ fontSize: 13, color: s.accent }}>✓</span>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>{scheme.label}</div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 4 }}>
                  <label className="a-label">Back Card Text</label>
                  <textarea className="a-input" rows={3} placeholder="Add any text for the back of the card…"
                    value={backText} onChange={e => setBackText(e.target.value)}
                    style={{ resize: 'vertical' }} />
                </div>
              </div>

              <div className="card" style={{ padding: 24, marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>2</span>
                  Quantity &amp; Expiry
                </div>

                <label className="a-label">Quantity (1–500)</label>
                <input className="a-input" type="tel" inputMode="numeric" value={quantity} onKeyDown={blockMinus}
                  onChange={e => setQuantity(Math.min(500, Math.max(1, parseInt(nonNegativeString(e.target.value)) || 1)))}
                  style={{ marginBottom: 20 }} />

                <label className="a-label" style={{ marginBottom: 10, display: 'block' }}>Card Validity</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {EXPIRY_PRESETS.map(p => (
                    <button key={p.years} onClick={() => setExpiryYears(p.years)}
                      className={expiryYears === p.years ? 'btn btn-green' : 'btn'} style={{ flex: 1 }}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
                  Expiry: <strong style={{ color: 'var(--text)' }}>{getExpiryDate(expiryYears)}</strong>
                </div>

                {genError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{genError}</div>}

                <button className="btn btn-green" onClick={handleGenerate} disabled={generating} style={{ width: '100%', fontSize: 15, padding: '12px 0' }}>
                  {generating ? 'Generating…' : `⚡ Generate Batch (${quantity} cards)`}
                </button>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: 32, marginBottom: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 16, textAlign: 'center' }}>✅</div>
              <h2 style={{ textAlign: 'center', margin: '0 0 8px' }}>Batch Generated!</h2>
              <p style={{ textAlign: 'center', color: 'var(--text3)', marginBottom: 24 }}>{cards.length} cards created successfully</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                {[{ label: 'Cards', value: cards.length }, { label: 'Batch ID', value: batchId }, { label: 'Batch Name', value: batchName }, { label: 'Expiry', value: getExpiryDate(expiryYears) }].map(({ label, value }) => (
                  <div key={label} className="stat" style={{ padding: '12px 16px' }}>
                    <div className="stat-lbl">{label}</div>
                    <div className="stat-val" style={{ fontSize: 16 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-green" onClick={downloadPDF} disabled={qrLoading || pdfLoading} style={{ flex: 1 }}>
                  {qrLoading ? '⏳ Building QR codes…' : pdfLoading ? '⏳ Generating PDF…' : '⬇️ Download PDF'}
                </button>
                <button className="btn" onClick={() => { setGenerated(false); setCards([]); setBatchId(''); setBatchName(''); setQrMap({}); setCvvMap({}) }} style={{ flex: 1 }}>
                  Generate Another
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: flip card preview */}
        <div style={{ position: 'sticky', top: 88 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Card Preview — {flipped ? 'Back' : 'Front'}
              </div>
              <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => setFlipped(f => !f)}>
                ↺ Flip
              </button>
            </div>

            <div className="flip-scene">
              <div className="flip-scene-wrap">
                <div className={`flip-card${flipped ? ' flipped' : ''}`} style={{ height: '100%', position: 'absolute', inset: 0 }}>
                  <div className="flip-face" style={{ borderRadius: 16, overflow: 'hidden' }}>
                    <CardFront batchName={batchName} scheme={scheme}
                      serial={generated && cards[0] ? cards[0].serial : previewSerial}
                      qrDataUrl={generated ? qrMap[cards[0]?.serial] : undefined} />
                  </div>
                  <div className="flip-face flip-back-face" style={{ borderRadius: 16, overflow: 'hidden' }}>
                    <CardBack scheme={scheme} backText={backText} cvv={generated && cards[0] ? (cvvMap[cards[0].serial] ?? '---') : '---'} />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
              <div>Scheme: <strong style={{ color: 'var(--text)' }}>{scheme.label}</strong></div>
              <div>Batch: <strong style={{ color: 'var(--text)' }}>{batchName || 'Not set'}</strong></div>
              {generated && <div>Range: <strong style={{ color: 'var(--text)' }}>{cards[0]?.serial} – {cards[cards.length - 1]?.serial}</strong></div>}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
