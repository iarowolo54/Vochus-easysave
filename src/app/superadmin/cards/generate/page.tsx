'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import type { jsPDF as JsPDF } from 'jspdf'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Field, PageHeader, Segmented, shortDate } from '../../_components/admin-ui'

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
  { label: '1 year', years: 1 },
  { label: '2 years', years: 2 },
  { label: '3 years', years: 3 },
]

const MAX_QTY = 500
const QR_BASE_URL = 'https://easysave.vochusglobalservices.co.uk/card/'

function getExpiryDate(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().slice(0, 10)
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

/** jsPDF exposes `internal.write` at runtime but not in its types; it's used for the clip path. */
function writeRaw(doc: JsPDF, op: string) {
  const internal: unknown = doc.internal
  if (internal && typeof internal === 'object' && 'write' in internal && typeof internal.write === 'function') {
    (internal.write as (s: string) => void)(op)
  }
}

// Printed card (PDF). Unchanged from the previous design.

function drawCardFront(
  doc: JsPDF, x: number, y: number, w: number, h: number,
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

  // Decorative rings, clipped to card bounds
  const sf = doc.internal.scaleFactor
  const ph = doc.internal.pageSize.getHeight()
  doc.saveGraphicsState()
  writeRaw(doc, `${(x * sf).toFixed(3)} ${((ph - y - h) * sf).toFixed(3)} ${(w * sf).toFixed(3)} ${(h * sf).toFixed(3)} re W n`)
  doc.setDrawColor(ci_r, ci_g, ci_b)
  doc.setLineWidth(0.6)
  doc.circle(x + w * 0.62, y + h * 0.45, h * 0.75, 'S')
  doc.setLineWidth(0.5)
  doc.circle(x + w * 0.18, y + h * 0.82, h * 0.55, 'S')
  doc.restoreGraphicsState()

  // VOCHUS, top left
  doc.setTextColor(acR, acG, acB)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(h * 0.19)
  doc.text('VOCHUS', x + w * 0.05, y + h * 0.2)

  // EASY SAVE, top right
  doc.setTextColor(es_r, es_g, es_b)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.09)
  doc.text('EASY SAVE', x + w * 0.95, y + h * 0.15, { align: 'right' })

  // QR box, left centre, small
  const qrPad = 1.2
  const qrSize = h * 0.2
  const qrX = x + w * 0.05
  const qrY = y + (h - qrSize) / 2 - h * 0.02
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2, 1.5, 1.5, 'F')
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  }

  // Serial, centred on card
  doc.setTextColor(txR, txG, txB)
  doc.setFont('courier', 'bold')
  doc.setFontSize(h * 0.14)
  doc.text(serial, x + w / 2, y + h * 0.55, { align: 'center', charSpace: 1.2 })

  // Batch name, bottom left (no label)
  doc.setTextColor(bn_r, bn_g, bn_b)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.12)
  const bn = batchName.length > 18 ? batchName.slice(0, 18) + '…' : batchName
  doc.text(bn, x + w * 0.05, y + h * 0.91)

  // MEMBER CARD label, bottom right
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
  doc: JsPDF, x: number, y: number, w: number, h: number,
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
  doc.setDrawColor(210, 206, 200)
  doc.setLineWidth(0.08)
  let sy = sigY + 1.2
  while (sy < sigY + sigH - 0.5) { doc.line(sigX + 0.5, sy, sigX + sigW - 0.5, sy); sy += 1.5 }
  doc.setTextColor(170, 166, 160)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(h * 0.075)
  doc.text('AUTHORISED SIGNATURE', sigX + 2, sigY + sigH - 2)

  // CVV box, number only, unique per card
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

// On-screen preview (not printed)

function CardFront({ batchName, scheme, serial, qrDataUrl }: {
  batchName: string; scheme: ColorScheme; serial: string; qrDataUrl?: string
}) {
  return (
    <div className="cs-mcard" style={{ background: scheme.bg }}>
      <div className="cs-mcard-ring cs-mcard-ring--a" style={{ borderColor: `${scheme.accent}20` }} />
      <div className="cs-mcard-ring cs-mcard-ring--b" style={{ borderColor: `${scheme.accent}15` }} />
      <div className="cs-mcard-top">
        <div className="cs-mcard-brand" style={{ color: scheme.accent }}>VOCHUS</div>
        <div className="cs-mcard-tag" style={{ color: `${scheme.text}77` }}>EASY SAVE</div>
      </div>
      <div className="cs-mcard-qrrow">
        <div className="cs-mcard-qr">
          {qrDataUrl
            ? <img src={qrDataUrl} alt={`QR code for ${serial}`} />
            : <Icons.qr size={20} aria-hidden="true" className="cs-mcard-qr-ph" />}
        </div>
      </div>
      <div className="cs-mcard-serial">
        <span style={{ color: scheme.text }}>{serial}</span>
      </div>
      <div className="cs-mcard-bottom">
        <div className="cs-mcard-batch" style={{ color: `${scheme.text}BB` }}>{batchName || 'Batch name'}</div>
        <div className="cs-mcard-end">
          <div className="cs-mcard-label" style={{ color: `${scheme.text}66` }}>MEMBER CARD</div>
          <div className="cs-mcard-chip" style={{ background: scheme.accent }} />
        </div>
      </div>
    </div>
  )
}

function CardBack({ scheme, backText, cvv }: { scheme: ColorScheme; backText: string; cvv: string }) {
  return (
    <div className="cs-mcard cs-mcard--back">
      <div className="cs-mcard-stripe" />
      <div className="cs-mcard-sigrow">
        <div className="cs-mcard-sig"><span>Authorised signature</span></div>
        <div className="cs-mcard-cvv">{cvv}</div>
      </div>
      <div className="cs-mcard-bottom">
        <div className="cs-mcard-logo">Vochus<span style={{ color: scheme.accent }}>.</span></div>
        <div className="cs-mcard-backtext">{backText || 'easysave.vochusglobalservices.co.uk'}</div>
      </div>
    </div>
  )
}

export default function GenerateCardsPage() {
  const [batchName, setBatchName] = useState('')
  const [nameError, setNameError] = useState('')
  const [schemeIdx, setSchemeIdx] = useState(0)
  const [qtyText, setQtyText] = useState('50')
  const [qtyError, setQtyError] = useState('')
  const [expiryYears, setExpiryYears] = useState(2)
  const [backText, setBackText] = useState('easysave.vochusglobalservices.co.uk\nsupport@vochus.ng')
  const [flipped, setFlipped] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [cards, setCards] = useState<GeneratedCard[]>([])
  const [batchId, setBatchId] = useState('')
  const [generated, setGenerated] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [cvvMap, setCvvMap] = useState<Record<string, string>>({})
  const [qrLoading, setQrLoading] = useState(false)
  const [qrFailed, setQrFailed] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [confirmRestart, setConfirmRestart] = useState(false)

  const scheme = COLOR_SCHEMES[schemeIdx]
  const previewSerial = 'VES-XXXX0001'
  const quantity = parseInt(qtyText, 10) || 0
  const expiry = getExpiryDate(expiryYears)
  const backLines = backText.split('\n').filter(Boolean).length

  const buildQrs = useCallback(() => {
    if (cards.length === 0) return
    setQrLoading(true); setQrFailed(false)
    Promise.all(
      cards.map(async c => {
        const dataUrl = await QRCode.toDataURL(`${QR_BASE_URL}${c.serial}`, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
        return [c.serial, dataUrl] as [string, string]
      })
    ).then(entries => { setQrMap(Object.fromEntries(entries)); setQrLoading(false) })
     .catch(() => { setQrFailed(true); setQrLoading(false) })
  }, [cards])

  useEffect(() => { if (generated) buildQrs() }, [generated, buildQrs])

  // The codes on the back aren't saved anywhere, so warn before leaving with an undownloaded batch.
  useEffect(() => {
    if (!generated || downloaded) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [generated, downloaded])

  const handleGenerate = async () => {
    let ok = true
    if (!batchName.trim()) { setNameError('Give the batch a name, like “June 2026 Lagos”.'); ok = false }
    if (quantity < 1 || quantity > MAX_QTY) { setQtyError(`Enter a number from 1 to ${MAX_QTY}.`); ok = false }
    if (!ok) return
    setGenError(''); setGenerating(true)
    try {
      // Serials and the batch id are generated server-side (unguessable); the
      // page renders whatever the server returns in `d.cards`.
      const r = await fetch('/api/admin/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchName: batchName.trim(), quantity, expiryDate: getExpiryDate(expiryYears) }),
      })
      const d = await r.json().catch(() => ({})) as { error?: string; batchId?: string; cards?: GeneratedCard[] }
      if (!r.ok || !d.cards || !d.batchId) { setGenError(d.error ?? 'The batch wasn’t created. Try again.'); return }
      const made = d.cards
      setBatchId(d.batchId); setCards(made); setGenerated(true); setDownloaded(false); setPdfError('')
      setCvvMap(Object.fromEntries(made.map(c => [c.serial, randomCvv()])))
    } catch {
      setGenError('No connection. Check your internet and try again. No cards were created.')
    } finally {
      setGenerating(false)
    }
  }

  const downloadPDF = async () => {
    if (qrLoading || qrFailed || cards.length === 0) return
    setPdfLoading(true); setPdfError('')
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
      setDownloaded(true)
    } catch {
      setPdfError('The PDF wasn’t created. Check your connection and try again.')
    } finally {
      setPdfLoading(false)
    }
  }

  function startAgain() {
    if (!downloaded) { setConfirmRestart(true); return }
    resetBatch()
  }

  function resetBatch() {
    setConfirmRestart(false)
    setGenerated(false); setCards([]); setBatchId(''); setBatchName(''); setQrMap({}); setCvvMap({}); setQrFailed(false); setPdfError(''); setDownloaded(false)
  }

  const pdfLabel = qrLoading ? 'Making QR codes…' : pdfLoading ? 'Making the PDF…' : downloaded ? 'Download PDF again' : 'Download PDF'

  return (
    <>
      <PageHeader
        title="Generate cards"
        sub="Create a batch of member cards with QR codes, ready to print."
        actions={<Link href="/superadmin/cards" className="btn btn-outline"><Icons.back size={18} aria-hidden="true" /> All cards</Link>}
      />

      <div className="cs-gen">
        <div className="cs-gen-main">
          {!generated ? (
            <form onSubmit={e => { e.preventDefault(); handleGenerate() }} noValidate>
              <section className="card cs-step" aria-labelledby="cs-step1">
                <div className="card-hd">
                  <h3 id="cs-step1"><span className="cs-step-no" aria-hidden="true">1</span> Batch details</h3>
                </div>
                <Field id="cs-batch" label="Batch name" error={nameError} hint="Printed on the front of every card. The first 18 characters fit.">
                  <input id="cs-batch" className="a-input" type="text" placeholder="e.g. June 2026 Lagos" autoComplete="off"
                    value={batchName} aria-invalid={!!nameError}
                    onChange={e => { setBatchName(e.target.value); setNameError('') }} />
                </Field>

                <fieldset className="cs-fieldset">
                  <legend className="a-label">Colour scheme</legend>
                  <div className="cs-swatches">
                    {COLOR_SCHEMES.map((s, i) => (
                      <button key={s.label} type="button" className="cs-swatch" aria-pressed={schemeIdx === i} onClick={() => setSchemeIdx(i)}>
                        <span className="cs-swatch-chip" style={{ background: `linear-gradient(135deg, ${s.bg} 60%, ${s.accent})` }} aria-hidden="true">
                          {schemeIdx === i && <Icons.check size={14} style={{ color: s.accent }} />}
                        </span>
                        <span className="cs-swatch-name">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <Field id="cs-back" label="Text on the back" hint={backLines > 4 ? 'Only the first 4 lines are printed.' : 'Up to 4 lines, printed bottom right.'}>
                  <textarea id="cs-back" className="a-input" rows={3} placeholder="Website, support email or phone"
                    value={backText} onChange={e => setBackText(e.target.value)} />
                </Field>
              </section>

              <section className="card cs-step" aria-labelledby="cs-step2">
                <div className="card-hd">
                  <h3 id="cs-step2"><span className="cs-step-no" aria-hidden="true">2</span> Quantity and expiry</h3>
                </div>
                <Field id="cs-qty" label="Number of cards" error={qtyError} hint={`From 1 to ${MAX_QTY} per batch.`}>
                  <input id="cs-qty" className="a-input cs-qty" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                    value={qtyText} aria-invalid={!!qtyError}
                    onChange={e => { setQtyText(e.target.value.replace(/\D/g, '').slice(0, 3)); setQtyError('') }} />
                </Field>

                <div className="a-field">
                  <span className="a-label" aria-hidden="true">Valid for</span>
                  <Segmented<string> label="Valid for" value={String(expiryYears)} onChange={v => setExpiryYears(Number(v))}
                    options={EXPIRY_PRESETS.map(p => ({ value: String(p.years), label: p.label }))} />
                  <p className="a-hint">Cards expire on <strong>{shortDate(expiry)}</strong>.</p>
                </div>

                {genError && <p className="a-alert a-alert-r cs-gap" role="alert">{genError}</p>}

                <button type="submit" className="btn btn-green cs-btn-block" disabled={generating}>
                  {generating ? 'Creating the batch…' : quantity > 0 ? `Generate ${quantity.toLocaleString('en-NG')} card${quantity === 1 ? '' : 's'}` : 'Generate cards'}
                </button>
              </section>
            </form>
          ) : (
            <section className="card" aria-labelledby="cs-done">
              <div className="cs-sent">
                <span className="cs-sent-ic" aria-hidden="true"><Icons.check size={20} /></span>
                <div>
                  <h3 id="cs-done">Batch created: {cards.length.toLocaleString('en-NG')} card{cards.length === 1 ? '' : 's'}</h3>
                  <p>Download the PDF and send it to the printer.</p>
                </div>
              </div>

              <dl className="cs-dl">
                <div><dt>Batch name</dt><dd>{batchName}</dd></div>
                <div><dt>Cards</dt><dd>{cards.length.toLocaleString('en-NG')}</dd></div>
                <div><dt>Expires</dt><dd>{shortDate(expiry)}</dd></div>
                <div><dt>Serials</dt><dd className="cs-mono">{cards[0]?.serial} to {cards[cards.length - 1]?.serial}</dd></div>
                <div className="cs-dl-wide"><dt>Batch ID</dt><dd className="cs-mono">{batchId}</dd></div>
              </dl>

              {!downloaded && (
                <p className="cs-note" role="note">
                  <Icons.report size={16} aria-hidden="true" />
                  <span>Download the PDF before you leave this page. The 3-digit codes on the back are made in this browser and aren’t saved, so this exact file can’t be made again.</span>
                </p>
              )}

              {qrFailed && (
                <div className="a-alert a-alert-r cs-alert-row cs-gap" role="alert">
                  <span>The QR codes couldn’t be made, so the PDF isn’t ready.</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={buildQrs}><Icons.retry size={16} aria-hidden="true" /> Try again</button>
                </div>
              )}
              {pdfError && <p className="a-alert a-alert-r cs-gap" role="alert">{pdfError}</p>}

              <div className="cs-actions">
                <button type="button" className="btn btn-green" onClick={downloadPDF} disabled={qrLoading || pdfLoading || qrFailed}>
                  <Icons.download size={18} aria-hidden="true" /> {pdfLabel}
                </button>
                <button type="button" className="btn btn-outline" onClick={startAgain} disabled={pdfLoading}>Start a new batch</button>
                <Link href="/superadmin/cards" className="btn btn-outline">See all cards</Link>
              </div>
            </section>
          )}
        </div>

        <aside className="cs-gen-side" aria-label="Card preview">
          <section className="card">
            <div className="card-hd">
              <h3>Preview: {flipped ? 'back' : 'front'}</h3>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setFlipped(f => !f)} aria-pressed={flipped}>
                <Icons.retry size={16} aria-hidden="true" /> {flipped ? 'Show front' : 'Show back'}
              </button>
            </div>

            <div className="cs-flip">
              <div className={`cs-flip-card${flipped ? ' is-flipped' : ''}`}>
                <div className="cs-flip-face" aria-hidden={flipped}>
                  <CardFront batchName={batchName} scheme={scheme}
                    serial={generated && cards[0] ? cards[0].serial : previewSerial}
                    qrDataUrl={generated ? qrMap[cards[0]?.serial] : undefined} />
                </div>
                <div className="cs-flip-face cs-flip-back" aria-hidden={!flipped}>
                  <CardBack scheme={scheme} backText={backText} cvv={generated && cards[0] ? (cvvMap[cards[0].serial] ?? '---') : '---'} />
                </div>
              </div>
            </div>

            <dl className="cs-meta">
              <div><dt>Scheme</dt><dd>{scheme.label}</dd></div>
              <div><dt>Batch</dt><dd>{batchName || 'Not set'}</dd></div>
              {generated && <div><dt>Range</dt><dd className="cs-mono">{cards[0]?.serial} to {cards[cards.length - 1]?.serial}</dd></div>}
            </dl>
            <p className="a-hint">The printed card is laid out slightly differently from this preview.</p>
          </section>
        </aside>
      </div>

      {confirmRestart && (
        <ConfirmModal
          title="Start a new batch without downloading?"
          body={<>You haven’t downloaded the PDF for <strong>{batchName}</strong> ({cards.length.toLocaleString('en-NG')} cards). The cards stay saved, but the 3-digit codes on the back are lost and this print file can’t be made again.</>}
          confirmLabel="Start a new batch" danger
          onConfirm={resetBatch} onClose={() => setConfirmRestart(false)}
        />
      )}
    </>
  )
}
