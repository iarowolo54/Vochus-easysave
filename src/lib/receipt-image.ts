// Draws a transaction receipt as a PNG (for "Save receipt image"). In the Android app the image is
// handed to the native side via the existing VochusSaveReceipt bridge; in a browser it downloads.
import { formatDate, formatTime } from './format'

export type ReceiptData = {
  title: string        // e.g. "Savings deposit"
  amount: string       // already signed and formatted, e.g. "+₦500.00"
  status: string       // "Completed"
  rows: [string, string][]
  reference: string
}

const INK = '#0f2a1d'
const MUTED = '#5e6b64'
const LINE = '#e6e6eb'
const BRAND_INK = '#146c34'

/** Only a completed payment is proof of anything; the pill colour has to say so too. */
export const showsProofOfPayment = (status: string) => status === 'Completed'
export function statusPillColors(status: string): { background: string; ink: string } {
  if (status === 'Completed') return { background: '#e7f3ea', ink: BRAND_INK }
  if (status === 'Pending' || status === 'Processing') return { background: '#fdf1dc', ink: '#8a5a00' }
  return { background: '#fbe6e4', ink: '#a8281c' }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  return lines
}

async function drawReceipt(data: ReceiptData): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; filename: string } | null> {
  try { await document.fonts.ready } catch {}
  const logo = await loadImage('/brand/logo-original.png')

  const W = 420, PAD = 28, ROW = 40
  // Header to divider ≈ 230px, one row per detail plus the reference, then the footer.
  const H = 230 + (data.rows.length + 1) * ROW + 96
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(2, 2)
  const font = (weight: number, size: number) => `${weight} ${size}px Inter, system-ui, sans-serif`

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Brand line
  if (logo) ctx.drawImage(logo, PAD, 26, 34, 34 * (logo.height / logo.width))
  ctx.fillStyle = INK
  ctx.font = font(700, 15)
  ctx.textAlign = 'left'
  ctx.fillText('Vochus Easy Save', PAD + 44, 48)
  ctx.fillStyle = MUTED
  ctx.font = font(500, 12)
  ctx.textAlign = 'right'
  ctx.fillText('Receipt', W - PAD, 48)

  // Title, amount, status
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = font(500, 13)
  ctx.fillText(data.title, W / 2, 104)
  ctx.fillStyle = INK
  ctx.font = font(700, 34)
  // A hair space keeps a leading +/− from crowding the naira sign at this size.
  ctx.fillText(data.amount.replace(/^([+−])/, '$1\u200A'), W / 2, 146)
  ctx.font = font(600, 12)
  const pillW = ctx.measureText(data.status).width + 28
  const pill = statusPillColors(data.status)
  ctx.fillStyle = pill.background
  ctx.beginPath()
  ctx.roundRect(W / 2 - pillW / 2, 162, pillW, 26, 13)
  ctx.fill()
  ctx.fillStyle = pill.ink
  ctx.fillText(data.status, W / 2, 179)

  // Dashed divider
  ctx.strokeStyle = LINE
  ctx.setLineDash([5, 4])
  ctx.beginPath(); ctx.moveTo(PAD, 210); ctx.lineTo(W - PAD, 210); ctx.stroke()
  ctx.setLineDash([])

  // Rows (label left, value right, wrapped if long)
  let y = 244
  for (const [label, value] of [...data.rows, ['Reference', data.reference] as [string, string]]) {
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = font(500, 12)
    ctx.fillText(label, PAD, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = INK
    ctx.font = font(600, 12)
    const lines = wrapText(ctx, value, W - PAD * 2 - 110)
    lines.forEach((l, i) => ctx.fillText(l, W - PAD, y + i * 15))
    y += ROW + (lines.length - 1) * 15
    ctx.strokeStyle = LINE
    ctx.beginPath(); ctx.moveTo(PAD, y - 24); ctx.lineTo(W - PAD, y - 24); ctx.stroke()
  }

  // Footer
  const now = new Date()
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = font(500, 11)
  if (showsProofOfPayment(data.status)) ctx.fillText('Keep this receipt as proof of payment.', W / 2, H - 52)
  ctx.fillText(`${window.location.host} · Generated ${formatDate(now)}, ${formatTime(now)}`, W / 2, H - 34)

  return { canvas, dataUrl: canvas.toDataURL('image/png'), filename: `vochus-receipt-${data.reference.slice(0, 24)}.png` }
}

/** The receipt drawn as a PNG data URL, for showing it inside a chat bubble. Null when the browser can't draw it. */
export async function receiptImageUrl(data: ReceiptData): Promise<string | null> {
  try {
    return (await drawReceipt(data))?.dataUrl ?? null
  } catch {
    return null
  }
}

type NativeWindow = { __vochusApp?: string; __vochusCanSaveReceipt?: boolean; VochusSaveReceipt?: { postMessage: (s: string) => void } }

function postToApp(dataUrl: string, filename: string): boolean {
  const w = window as unknown as NativeWindow
  if (!(w.__vochusCanSaveReceipt && w.VochusSaveReceipt)) return false
  w.VochusSaveReceipt.postMessage(JSON.stringify({ data: dataUrl, filename }))
  return true
}

/**
 * Where "Save receipt image" should send the picture. An app build with the bridge saves it natively. An app build without it
 * (an older install) must not navigate to the raw image, which a WebView shows at full size and far zoomed in, so the picture
 * is shown fitted to the screen instead. A normal browser downloads it.
 */
export function receiptSaveMode(i: { hasBridge: boolean; inApp: boolean }): 'bridge' | 'preview' | 'download' {
  if (i.hasBridge) return 'bridge'
  return i.inApp ? 'preview' : 'download'
}

/** Shows the receipt picture over the page, fitted to the screen width, so it can be pressed and held to save or screenshotted. */
function showReceiptPreview(dataUrl: string) {
  // A dialog opened with showModal() joins the browser's top layer, so it shows above the receipt sheet that is already open.
  const overlay = document.createElement('dialog')
  overlay.setAttribute('aria-label', 'Receipt image')
  overlay.style.cssText = 'position:fixed;inset:0;margin:0;width:100%;height:100%;max-width:none;max-height:none;border:0;padding:16px;box-sizing:border-box;background:rgba(15,42,29,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;overflow:auto'
  const img = document.createElement('img')
  img.src = dataUrl
  img.alt = 'Receipt'
  img.style.cssText = 'display:block;width:100%;max-width:420px;height:auto;border-radius:12px;background:#fff'
  const hint = document.createElement('p')
  hint.textContent = 'Press and hold the receipt to save it, or take a screenshot.'
  hint.style.cssText = 'margin:0;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.style.cssText = 'min-height:44px;padding:0 28px;border:0;border-radius:999px;background:#fff;color:#0f2a1d;font:700 15px system-ui,sans-serif'
  close.onclick = () => overlay.close()
  overlay.addEventListener('close', () => overlay.remove())
  overlay.append(img, hint, close)
  document.body.appendChild(overlay)
  overlay.showModal()
}

export async function saveReceiptImage(data: ReceiptData) {
  const img = await drawReceipt(data)
  if (!img) return
  const w = window as unknown as NativeWindow
  const mode = receiptSaveMode({
    hasBridge: !!(w.__vochusCanSaveReceipt && w.VochusSaveReceipt),
    inApp: !!w.__vochusApp || /; wv\)/.test(navigator.userAgent),
  })
  if (mode === 'bridge') { postToApp(img.dataUrl, img.filename); return }
  if (mode === 'preview') { showReceiptPreview(img.dataUrl); return }
  const link = document.createElement('a')
  link.download = img.filename
  link.href = img.dataUrl
  link.click()
}

/**
 * Shares the receipt as a picture. In the app the native side opens the phone's share sheet with the image;
 * in a browser the Web Share API is used when it can send files. Returns false when neither is available,
 * so the caller can fall back to sharing text.
 */
export async function shareReceiptImage(data: ReceiptData): Promise<boolean> {
  const img = await drawReceipt(data)
  if (!img) return false
  if (postToApp(img.dataUrl, img.filename)) return true
  const blob = await new Promise<Blob | null>(resolve => img.canvas.toBlob(resolve, 'image/png'))
  if (!blob || !navigator.canShare || !navigator.share) return false
  const file = new File([blob], img.filename, { type: 'image/png' })
  if (!navigator.canShare({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: data.title })
  } catch (e) {
    // Closing the share sheet is a choice, not a failure; don't fall back to text after it.
    if (e instanceof DOMException && e.name === 'AbortError') return true
    return false
  }
  return true
}
