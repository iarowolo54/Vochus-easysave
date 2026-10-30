'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, PageHeader, useToast } from '../../_components/admin-ui'

const CANVAS_W = 856
const CANVAS_H = 540
const QR_PAD = 6

interface Overlay {
  qrX: number; qrY: number; qrSize: number
  valueFontSize: number
  serialFontSize: number
  tierFontSize: number
  scanLabelFontSize: number
  valueColor: string
  serialColor: string
  tierColor: string
  scanLabelColor: string
  showValue: boolean
  showSerial: boolean
  showTier: boolean
  showScanLabel: boolean
  valueText: string
  serialText: string
  tierText: string
  scanLabelText: string
  valueX: number; valueY: number
  serialX: number; serialY: number
  tierX: number; tierY: number
  scanLabelX: number; scanLabelY: number
}

type KeysOf<T> = { [K in keyof Overlay]: Overlay[K] extends T ? K : never }[keyof Overlay]
type NumKey = KeysOf<number>
type StrKey = KeysOf<string>
type BoolKey = KeysOf<boolean>

const DEFAULT: Overlay = {
  qrX: 590, qrY: 60, qrSize: 200,
  valueFontSize: 80, serialFontSize: 22, tierFontSize: 20, scanLabelFontSize: 16,
  valueColor: '#FFFFFF', serialColor: '#FFFFFF', tierColor: '#F59E0B', scanLabelColor: '#F59E0B',
  showValue: true, showSerial: true, showTier: true, showScanLabel: true,
  valueText: '₦2,500', serialText: 'GC-XXXX-00000001',
  tierText: 'SILVER', scanLabelText: 'SCAN TO REDEEM',
  valueX: 60, valueY: 300,
  serialX: 40, serialY: 510,
  tierX: 700, tierY: 40,
  scanLabelX: 0, scanLabelY: 0,
}

type DragTarget = 'qr' | 'value' | 'serial' | 'tier' | null

interface TextLayer {
  id: string; title: string; show: BoolKey; text?: StrKey; size: NumKey; sizeMin: number; sizeMax: number
  color: StrKey; x?: NumKey; y?: NumKey
}

const TEXT_LAYERS: TextLayer[] = [
  { id: 'value', title: 'Card value', show: 'showValue', text: 'valueText', size: 'valueFontSize', sizeMin: 20, sizeMax: 140, color: 'valueColor', x: 'valueX', y: 'valueY' },
  { id: 'tier', title: 'Tier label', show: 'showTier', text: 'tierText', size: 'tierFontSize', sizeMin: 10, sizeMax: 60, color: 'tierColor', x: 'tierX', y: 'tierY' },
  { id: 'serial', title: 'Serial number', show: 'showSerial', size: 'serialFontSize', sizeMin: 10, sizeMax: 50, color: 'serialColor', x: 'serialX', y: 'serialY' },
  { id: 'scan', title: 'Scan label', show: 'showScanLabel', text: 'scanLabelText', size: 'scanLabelFontSize', sizeMin: 8, sizeMax: 40, color: 'scanLabelColor' },
]

function hitTest(mx: number, my: number, x: number, y: number, w: number, h: number, pad = 10) {
  return mx >= x - pad && mx <= x + w + pad && my >= y - pad && my <= y + h + pad
}

export default function GiftCardEditorPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null)
  const [bgFile, setBgFile] = useState<File | null>(null)
  const [bgError, setBgError] = useState('')
  const [o, setO] = useState<Overlay>({ ...DEFAULT })
  const [qrImg, setQrImg] = useState<HTMLImageElement | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  const [exporting, setExporting] = useState<'' | 'png' | 'pdf'>('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [toastNode, toast] = useToast()

  const dragTarget = useRef<DragTarget>(null)
  const resizing = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ mx: 0, my: 0, size: 0 })

  const oRef = useRef(o)
  useEffect(() => { oRef.current = o }, [o])

  const set = useCallback(<K extends keyof Overlay>(k: K, v: Overlay[K]) => setO(prev => ({ ...prev, [k]: v })), [])

  // QR image for the current serial, loaded once per change so drawing stays synchronous.
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(o.serialText || 'GC-PREVIEW', {
      width: 400, margin: 1, color: { dark: '#000000', light: '#ffffff' },
    }).then(url => {
      const img = new Image()
      img.onload = () => { if (!cancelled) { setQrImg(img); setQrFailed(false) } }
      img.onerror = () => { if (!cancelled) setQrFailed(true) }
      img.src = url
    }).catch(() => { if (!cancelled) setQrFailed(true) })
    return () => { cancelled = true }
  }, [o.serialText])

  /** Draws the card. `forExport` leaves out the editing handle and the empty-state prompt. */
  const draw = useCallback((forExport = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ov = oRef.current

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

    // Background
    if (bgImg) {
      const scale = Math.max(CANVAS_W / bgImg.width, CANVAS_H / bgImg.height)
      const sw = bgImg.width * scale, sh = bgImg.height * scale
      ctx.drawImage(bgImg, (CANVAS_W - sw) / 2, (CANVAS_H - sh) / 2, sw, sh)
      // dim overlay for legibility
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    } else {
      ctx.fillStyle = '#0D1C15'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = '#3FBF8030'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      if (!forExport) {
        ctx.fillStyle = '#3FBF8066'
        ctx.font = '18px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Upload a background image', CANVAS_W / 2, CANVAS_H / 2)
        ctx.textAlign = 'left'
      }
    }

    const qx = Math.max(0, Math.min(ov.qrX, CANVAS_W - ov.qrSize))
    const qy = Math.max(0, Math.min(ov.qrY, CANVAS_H - ov.qrSize))

    // QR code
    if (qrImg) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(qx - QR_PAD, qy - QR_PAD, ov.qrSize + QR_PAD * 2, ov.qrSize + QR_PAD * 2, 8)
      else ctx.rect(qx - QR_PAD, qy - QR_PAD, ov.qrSize + QR_PAD * 2, ov.qrSize + QR_PAD * 2)
      ctx.fill()
      ctx.drawImage(qrImg, qx, qy, ov.qrSize, ov.qrSize)

      if (!forExport) {
        // Resize handle (on screen only)
        const hx = qx + ov.qrSize + QR_PAD, hy = qy + ov.qrSize + QR_PAD
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#3FBF80'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(hx, hy, 10, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(hx - 4, hy - 4); ctx.lineTo(hx + 4, hy + 4)
        ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 4, hy + 4); ctx.lineTo(hx, hy + 4)
        ctx.moveTo(hx - 4, hy); ctx.lineTo(hx - 4, hy - 4); ctx.lineTo(hx, hy - 4)
        ctx.stroke()
      }
    }

    // Scan label under QR
    if (ov.showScanLabel) {
      const slX = ov.scanLabelX === 0 && ov.scanLabelY === 0 ? qx + ov.qrSize / 2 : ov.scanLabelX
      const slY = ov.scanLabelX === 0 && ov.scanLabelY === 0 ? qy + ov.qrSize + 24 : ov.scanLabelY
      ctx.fillStyle = ov.scanLabelColor
      ctx.font = `bold ${ov.scanLabelFontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(ov.scanLabelText, slX, slY)
      ctx.textAlign = 'left'
    }

    // Value
    if (ov.showValue) {
      ctx.fillStyle = ov.valueColor
      ctx.font = `bold ${ov.valueFontSize}px 'Arial', sans-serif`
      ctx.fillText(ov.valueText, ov.valueX, ov.valueY)
    }

    // Serial
    if (ov.showSerial) {
      ctx.fillStyle = ov.serialColor
      ctx.font = `${ov.serialFontSize}px monospace`
      ctx.fillText(ov.serialText, ov.serialX, ov.serialY)
    }

    // Tier
    if (ov.showTier) {
      ctx.fillStyle = ov.tierColor
      ctx.font = `bold ${ov.tierFontSize}px sans-serif`
      ctx.textAlign = 'right'
      ctx.fillText(ov.tierText, ov.tierX, ov.tierY)
      ctx.textAlign = 'left'
    }
  }, [bgImg, qrImg])

  useEffect(() => { draw() }, [draw, o])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const sx = CANVAS_W / rect.width, sy = CANVAS_H / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      if (!t) return null
      return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy }
    }
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const pos = getPos(e)
    if (!pos) return
    const { x, y } = pos
    const ov = oRef.current
    const qx = Math.max(0, Math.min(ov.qrX, CANVAS_W - ov.qrSize))
    const qy = Math.max(0, Math.min(ov.qrY, CANVAS_H - ov.qrSize))
    const hr = 14

    // resize handle
    const hx = qx + ov.qrSize + QR_PAD, hy = qy + ov.qrSize + QR_PAD
    if (Math.hypot(x - hx, y - hy) < hr) {
      resizing.current = true
      resizeStart.current = { mx: x, my: y, size: ov.qrSize }
      return
    }
    // QR drag
    if (hitTest(x, y, qx, qy, ov.qrSize, ov.qrSize)) {
      dragTarget.current = 'qr'
      dragOffset.current = { x: x - qx, y: y - qy }
      return
    }
    // Text hit tests (approximate bounding boxes)
    const approxW = (text: string, fs: number) => text.length * fs * 0.6
    if (ov.showValue && hitTest(x, y, ov.valueX, ov.valueY - ov.valueFontSize, approxW(ov.valueText, ov.valueFontSize), ov.valueFontSize)) {
      dragTarget.current = 'value'; dragOffset.current = { x: x - ov.valueX, y: y - ov.valueY }; return
    }
    if (ov.showSerial && hitTest(x, y, ov.serialX, ov.serialY - ov.serialFontSize, approxW(ov.serialText, ov.serialFontSize), ov.serialFontSize)) {
      dragTarget.current = 'serial'; dragOffset.current = { x: x - ov.serialX, y: y - ov.serialY }; return
    }
    if (ov.showTier && hitTest(x, y, ov.tierX - approxW(ov.tierText, ov.tierFontSize), ov.tierY - ov.tierFontSize, approxW(ov.tierText, ov.tierFontSize), ov.tierFontSize)) {
      dragTarget.current = 'tier'; dragOffset.current = { x: x - ov.tierX, y: y - ov.tierY }; return
    }
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!resizing.current && !dragTarget.current) return
    const pos = getPos(e)
    if (!pos) return
    const { x, y } = pos
    if (resizing.current) {
      const delta = Math.max(x - resizeStart.current.mx, y - resizeStart.current.my)
      const newSize = Math.max(60, Math.min(380, resizeStart.current.size + delta))
      setO(prev => ({ ...prev, qrSize: Math.round(newSize) }))
      return
    }
    const dx = Math.round(x - dragOffset.current.x), dy = Math.round(y - dragOffset.current.y)
    switch (dragTarget.current) {
      case 'qr': setO(prev => ({ ...prev, qrX: dx, qrY: dy })); break
      case 'value': setO(prev => ({ ...prev, valueX: dx, valueY: dy })); break
      case 'serial': setO(prev => ({ ...prev, serialX: dx, serialY: dy })); break
      case 'tier': setO(prev => ({ ...prev, tierX: dx, tierY: dy })); break
    }
  }

  function onUp() { dragTarget.current = null; resizing.current = false }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setBgError('That file isn’t an image. Choose a PNG or JPG.'); return }
    setBgError('')
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result
      if (typeof src !== 'string') { setBgError('That image couldn’t be read. Try another file.'); return }
      const img = new Image()
      img.onload = () => { setBgImg(img); setBgFile(file) }
      img.onerror = () => setBgError('That image couldn’t be opened. Try a PNG or JPG.')
      img.src = src
    }
    reader.onerror = () => setBgError('That image couldn’t be read. Try another file.')
    reader.readAsDataURL(file)
  }

  /** Renders a clean copy (no handle), hands back its PNG data URL, then redraws the editor view. */
  function exportImage() {
    const canvas = canvasRef.current
    if (!canvas) throw new Error('no canvas')
    draw(true)
    try { return canvas.toDataURL('image/png') } finally { draw(false) }
  }

  function downloadPNG() {
    setExporting('png')
    try {
      const link = document.createElement('a')
      link.download = `gift-card-${o.serialText}.png`
      link.href = exportImage()
      link.click()
    } catch {
      toast('The image wasn’t saved. Try again.', 'error')
    } finally {
      setExporting('')
    }
  }

  async function downloadPDF() {
    setExporting('pdf')
    try {
      const imgData = exportImage()
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ unit: 'px', format: [CANVAS_W, CANVAS_H], orientation: 'landscape' })
      pdf.addImage(imgData, 'PNG', 0, 0, CANVAS_W, CANVAS_H)
      pdf.save(`gift-card-${o.serialText}.pdf`)
    } catch {
      toast('The PDF wasn’t created. Check your connection and try again.', 'error')
    } finally {
      setExporting('')
    }
  }

  function reset() { setO({ ...DEFAULT }); setBgImg(null); setBgFile(null); setBgError(''); setConfirmReset(false) }

  const slider = (id: string, label: string, key: NumKey, min: number, max: number, step = 1) => (
    <div className="cs-range">
      <div className="cs-range-hd">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="cs-mono">{o[key]}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={o[key]}
        onChange={e => set(key, parseFloat(e.target.value))} />
    </div>
  )

  return (
    <>
      <PageHeader
        title="Gift card editor"
        sub="Upload a background, place the QR code and text, then download the card."
        actions={<button type="button" className="btn btn-outline" onClick={() => setConfirmReset(true)}><Icons.retry size={18} aria-hidden="true" /> Reset design</button>}
      />

      <div className="cs-editor">
        <div className="cs-editor-stage">
          <section className="card">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="cs-canvas"
              role="img"
              aria-label={`Gift card design${o.showValue ? `, value ${o.valueText}` : ''}${o.showTier ? `, ${o.tierText}` : ''}`}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={onDown}
              onTouchMove={onMove}
              onTouchEnd={onUp}
              onTouchCancel={onUp}
            />
            <p className="a-hint cs-center">Drag the QR code or any text to move it. Drag the round handle at the QR code’s corner to resize it. You can also use the position controls.</p>
            {qrFailed && <p className="a-alert a-alert-r cs-gap" role="alert">The QR code couldn’t be made for this serial. Check the text under QR code and try again.</p>}
            <div className="cs-actions">
              <button type="button" className="btn btn-green" onClick={downloadPNG} disabled={!!exporting}>
                <Icons.download size={18} aria-hidden="true" /> {exporting === 'png' ? 'Saving…' : 'Download PNG'}
              </button>
              <button type="button" className="btn btn-outline" onClick={downloadPDF} disabled={!!exporting}>
                <Icons.download size={18} aria-hidden="true" /> {exporting === 'pdf' ? 'Making the PDF…' : 'Download PDF'}
              </button>
            </div>
          </section>
        </div>

        <div className="cs-editor-controls">
          <section className="card" aria-labelledby="cs-bg-h">
            <div className="card-hd"><h3 id="cs-bg-h">Background</h3></div>
            <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
            <button type="button" className="cs-drop" onClick={() => fileInputRef.current?.click()}>
              <span className="row-ic" aria-hidden="true">{bgFile ? <Icons.check size={18} /> : <Icons.image size={18} />}</span>
              <span className="cs-drop-text">
                <span className="cs-drop-title">{bgFile ? bgFile.name : 'Upload an image'}</span>
                <span className="cs-drop-sub">{bgFile ? 'Tap to replace it' : 'PNG or JPG. It’s cropped to fit the card.'}</span>
              </span>
            </button>
            {bgError && <p className="a-field-error" role="alert"><Icons.error size={14} aria-hidden="true" /> {bgError}</p>}
            {bgFile && <button type="button" className="card-link cs-gap" onClick={() => { setBgImg(null); setBgFile(null) }}>Remove background</button>}
          </section>

          <section className="card" aria-labelledby="cs-qr-h">
            <div className="card-hd"><h3 id="cs-qr-h">QR code</h3></div>
            <div className="a-field">
              <label className="a-label" htmlFor="cs-qr-text">QR content and serial</label>
              <input id="cs-qr-text" className="a-input cs-mono" value={o.serialText} autoComplete="off" spellCheck={false}
                onChange={e => set('serialText', e.target.value)} />
              <p className="a-hint">The QR code holds this text, and it’s printed as the serial number.</p>
            </div>
            {slider('cs-qr-size', 'Size', 'qrSize', 60, 380)}
            {slider('cs-qr-x', 'Across', 'qrX', 0, CANVAS_W - o.qrSize)}
            {slider('cs-qr-y', 'Down', 'qrY', 0, CANVAS_H - o.qrSize)}
          </section>

          <section className="card" aria-labelledby="cs-text-h">
            <div className="card-hd"><h3 id="cs-text-h">Text</h3></div>
            {TEXT_LAYERS.map(l => (
              <div key={l.id} className="cs-layer" role="group" aria-labelledby={`cs-${l.id}-h`}>
                <div className="cs-layer-hd">
                  <h4 id={`cs-${l.id}-h`} className="cs-layer-title">{l.title}</h4>
                  <label className="cs-check">
                    <input type="checkbox" checked={o[l.show]} onChange={e => set(l.show, e.target.checked)} />
                    <span>Show<span className="sr-only"> {l.title.toLowerCase()}</span></span>
                  </label>
                </div>
                {o[l.show] && (
                  <>
                    {l.text && (
                      <div className="a-field">
                        <label className="sr-only" htmlFor={`cs-${l.id}-text`}>{l.title} text</label>
                        <input id={`cs-${l.id}-text`} className="a-input" value={o[l.text]} autoComplete="off"
                          onChange={e => { const k = l.text; if (k) set(k, e.target.value) }} />
                      </div>
                    )}
                    {!l.text && <p className="a-hint cs-layer-note">Uses the QR content above.</p>}
                    {slider(`cs-${l.id}-size`, 'Text size', l.size, l.sizeMin, l.sizeMax)}
                    {l.x && slider(`cs-${l.id}-x`, 'Across', l.x, 0, CANVAS_W)}
                    {l.y && slider(`cs-${l.id}-y`, 'Down', l.y, 0, CANVAS_H)}
                    {!l.x && <p className="a-hint cs-layer-note">Sits under the QR code and moves with it.</p>}
                    <div className="cs-color">
                      <label htmlFor={`cs-${l.id}-color`}>Colour</label>
                      <input id={`cs-${l.id}-color`} type="color" value={o[l.color]} onChange={e => set(l.color, e.target.value)} />
                      <span className="cs-mono">{o[l.color].toUpperCase()}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </section>
        </div>
      </div>

      {confirmReset && (
        <ConfirmModal
          title="Reset the design?"
          body={<>This clears the background image and puts the QR code and all text back to their starting size, position, colour and wording.</>}
          confirmLabel="Reset design" danger
          onConfirm={reset} onClose={() => setConfirmReset(false)}
        />
      )}

      {toastNode}
    </>
  )
}
