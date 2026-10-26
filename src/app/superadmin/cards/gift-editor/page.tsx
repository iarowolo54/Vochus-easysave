'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'

const CANVAS_W = 856
const CANVAS_H = 540

type Handle = 'br' | null

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

type DragTarget = 'qr' | 'value' | 'serial' | 'tier' | 'scanLabel' | null
type ResizeTarget = 'qr' | null

function hitTest(mx: number, my: number, x: number, y: number, w: number, h: number, pad = 10) {
  return mx >= x - pad && mx <= x + w + pad && my >= y - pad && my <= y + h + pad
}

export default function GiftCardEditorPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null)
  const [bgFile, setBgFile] = useState<File | null>(null)
  const [o, setO] = useState<Overlay>({ ...DEFAULT })
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const dragTarget = useRef<DragTarget>(null)
  const resizeTarget = useRef<ResizeTarget>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ mx: 0, my: 0, size: 0 })

  const oRef = useRef(o)
  useEffect(() => { oRef.current = o }, [o])

  // Generate QR
  useEffect(() => {
    QRCode.toDataURL(o.serialText || 'GC-PREVIEW', {
      width: 400, margin: 1, color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {})
  }, [o.serialText])

  const draw = useCallback(async () => {
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
      ctx.fillStyle = '#3FBF8066'
      ctx.font = '18px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Upload a background image', CANVAS_W / 2, CANVAS_H / 2)
      ctx.textAlign = 'left'
    }

    const qx = Math.max(0, Math.min(ov.qrX, CANVAS_W - ov.qrSize))
    const qy = Math.max(0, Math.min(ov.qrY, CANVAS_H - ov.qrSize))

    // QR code
    if (qrDataUrl) {
      await new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => {
          const pad = 6
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ;(ctx as any).roundRect?.(qx - pad, qy - pad, ov.qrSize + pad * 2, ov.qrSize + pad * 2, 8) || ctx.rect(qx - pad, qy - pad, ov.qrSize + pad * 2, ov.qrSize + pad * 2)
          ctx.fill()
          ctx.drawImage(img, qx, qy, ov.qrSize, ov.qrSize)
          // resize handle
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = '#3FBF80'
          ctx.lineWidth = 2
          const hr = 10
          ctx.beginPath()
          ctx.arc(qx + ov.qrSize + pad, qy + ov.qrSize + pad, hr, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = '#3FBF80'
          ctx.font = 'bold 11px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('⤡', qx + ov.qrSize + pad, qy + ov.qrSize + pad + 4)
          ctx.textAlign = 'left'
          resolve()
        }
        img.src = qrDataUrl
      })
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
  }, [bgImg, qrDataUrl])

  useEffect(() => { draw() }, [draw, o])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const sx = CANVAS_W / rect.width, sy = CANVAS_H / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy }
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * sx, y: ((e as React.MouseEvent).clientY - rect.top) * sy }
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if ('touches' in e) e.preventDefault()
    const { x, y } = getPos(e)
    const ov = oRef.current
    const qx = Math.max(0, Math.min(ov.qrX, CANVAS_W - ov.qrSize))
    const qy = Math.max(0, Math.min(ov.qrY, CANVAS_H - ov.qrSize))
    const pad = 6, hr = 14

    // resize handle
    const hx = qx + ov.qrSize + pad, hy = qy + ov.qrSize + pad
    if (Math.hypot(x - hx, y - hy) < hr) {
      resizeTarget.current = 'qr'
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
    if ('touches' in e) e.preventDefault()
    const { x, y } = getPos(e)
    if (resizeTarget.current === 'qr') {
      const delta = Math.max(x - resizeStart.current.mx, y - resizeStart.current.my)
      const newSize = Math.max(60, Math.min(380, resizeStart.current.size + delta))
      setO(prev => ({ ...prev, qrSize: Math.round(newSize) }))
      return
    }
    if (!dragTarget.current) return
    const dx = x - dragOffset.current.x, dy = y - dragOffset.current.y
    switch (dragTarget.current) {
      case 'qr': setO(prev => ({ ...prev, qrX: Math.round(dx), qrY: Math.round(dy) })); break
      case 'value': setO(prev => ({ ...prev, valueX: Math.round(dx), valueY: Math.round(dy) })); break
      case 'serial': setO(prev => ({ ...prev, serialX: Math.round(dx), serialY: Math.round(dy) })); break
      case 'tier': setO(prev => ({ ...prev, tierX: Math.round(dx), tierY: Math.round(dy) })); break
    }
  }

  function onUp() { dragTarget.current = null; resizeTarget.current = null }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBgFile(file)
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => setBgImg(img)
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  function downloadPNG() {
    const canvas = canvasRef.current; if (!canvas) return
    const link = document.createElement('a')
    link.download = `gift-card-${o.serialText}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  async function downloadPDF() {
    const canvas = canvasRef.current; if (!canvas) return
    const { jsPDF } = await import('jspdf')
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ unit: 'px', format: [CANVAS_W, CANVAS_H], orientation: 'landscape' })
    pdf.addImage(imgData, 'PNG', 0, 0, CANVAS_W, CANVAS_H)
    pdf.save(`gift-card-${o.serialText}.pdf`)
  }

  function reset() { setO({ ...DEFAULT }); setBgImg(null); setBgFile(null) }

  const sl = (label: string, key: keyof Overlay, min: number, max: number, step = 1) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: 'var(--text3)' }}>{label}</span>
        <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{o[key] as number}</strong>
      </div>
      <input type="range" min={min} max={max} step={step} value={o[key] as number}
        onChange={e => setO(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
        style={{ width: '100%', accentColor: 'var(--accent)' }} />
    </div>
  )

  return (
    <>
      <div className="pg-hd">
        <div><h1>Gift Card Editor</h1><p>Upload a background, drag to position the QR code and text overlays, then export</p></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 20, alignItems: 'start' }}>

        {/* Canvas */}
        <div>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ width: '100%', borderRadius: 12, border: '1.5px solid var(--border)', cursor: 'grab', display: 'block', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
            Drag the QR code or any text element directly on the canvas. Drag the green ⤡ handle to resize the QR.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-green" style={{ flex: 1 }} onClick={downloadPNG}>⬇ Download PNG</button>
            <button className="btn" style={{ flex: 1 }} onClick={downloadPDF}>⬇ Download PDF</button>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Background */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Background Image</div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
            <div onClick={() => fileInputRef.current?.click()}
              style={{ border: '1.5px dashed var(--border)', borderRadius: 8, padding: '14px 12px', textAlign: 'center', cursor: 'pointer', background: 'var(--surface2)', fontSize: 13 }}>
              {bgFile ? <><div style={{ fontWeight: 600, color: 'var(--accent)' }}>✓ {bgFile.name}</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Click to replace</div></>
                : <><div style={{ color: 'var(--text3)' }}>Click to upload image</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>PNG, JPG — any size</div></>}
            </div>
          </div>

          {/* QR */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>QR Code</div>
            {sl('Size', 'qrSize', 60, 380)}
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Position X: {o.qrX} Y: {o.qrY} — drag on canvas</div>
            <label style={{ fontSize: 12, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>QR Content / Serial</label>
            <input className="a-input" value={o.serialText} onChange={e => setO(prev => ({ ...prev, serialText: e.target.value }))} style={{ marginBottom: 0, fontSize: 12 }} />
          </div>

          {/* Text overlays */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Text Overlays</div>

            {/* Value */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Card Value</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={o.showValue} onChange={e => setO(prev => ({ ...prev, showValue: e.target.checked }))} />
                  Show
                </label>
              </div>
              <input className="a-input" value={o.valueText} onChange={e => setO(prev => ({ ...prev, valueText: e.target.value }))} style={{ marginBottom: 8, fontSize: 12 }} />
              {sl('Font size', 'valueFontSize', 20, 140)}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>Color</span>
                <input type="color" value={o.valueColor} onChange={e => setO(prev => ({ ...prev, valueColor: e.target.value }))} style={{ width: 32, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
            </div>

            {/* Tier */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Tier Label</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={o.showTier} onChange={e => setO(prev => ({ ...prev, showTier: e.target.checked }))} />
                  Show
                </label>
              </div>
              <input className="a-input" value={o.tierText} onChange={e => setO(prev => ({ ...prev, tierText: e.target.value }))} style={{ marginBottom: 8, fontSize: 12 }} />
              {sl('Font size', 'tierFontSize', 10, 60)}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>Color</span>
                <input type="color" value={o.tierColor} onChange={e => setO(prev => ({ ...prev, tierColor: e.target.value }))} style={{ width: 32, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
            </div>

            {/* Serial */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Serial Number</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={o.showSerial} onChange={e => setO(prev => ({ ...prev, showSerial: e.target.checked }))} />
                  Show
                </label>
              </div>
              {sl('Font size', 'serialFontSize', 10, 50)}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>Color</span>
                <input type="color" value={o.serialColor} onChange={e => setO(prev => ({ ...prev, serialColor: e.target.value }))} style={{ width: 32, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
            </div>

            {/* Scan label */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Scan Label</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={o.showScanLabel} onChange={e => setO(prev => ({ ...prev, showScanLabel: e.target.checked }))} />
                  Show
                </label>
              </div>
              <input className="a-input" value={o.scanLabelText} onChange={e => setO(prev => ({ ...prev, scanLabelText: e.target.value }))} style={{ marginBottom: 8, fontSize: 12 }} />
              {sl('Font size', 'scanLabelFontSize', 8, 40)}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>Color</span>
                <input type="color" value={o.scanLabelColor} onChange={e => setO(prev => ({ ...prev, scanLabelColor: e.target.value }))} style={{ width: 32, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
            </div>
          </div>

          <button className="btn" onClick={reset} style={{ fontSize: 12 }}>↺ Reset to defaults</button>
        </div>
      </div>
    </>
  )
}
