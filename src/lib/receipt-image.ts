// Draws a transaction receipt as a PNG (for "Save receipt image"). In the Android app the image is
// handed to the native side via the existing VochusSaveReceipt bridge; in a browser it downloads.
import { formatDate, formatTime } from './format'

type ReceiptData = {
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

export async function saveReceiptImage(data: ReceiptData) {
  try { await document.fonts.ready } catch {}
  const logo = await loadImage('/brand/logo-original.png')

  const W = 420, PAD = 28, ROW = 40
  // Header to divider ≈ 230px, one row per detail plus the reference, then the footer.
  const H = 230 + (data.rows.length + 1) * ROW + 96
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return
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
  ctx.fillStyle = '#e7f3ea'
  ctx.beginPath()
  ctx.roundRect(W / 2 - pillW / 2, 162, pillW, 26, 13)
  ctx.fill()
  ctx.fillStyle = BRAND_INK
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
  ctx.fillText('Keep this receipt as proof of payment.', W / 2, H - 52)
  ctx.fillText(`${window.location.host} · Generated ${formatDate(now)}, ${formatTime(now)}`, W / 2, H - 34)

  const dataUrl = canvas.toDataURL('image/png')
  const filename = `vochus-receipt-${data.reference.slice(0, 24)}.png`
  const w = window as unknown as { __vochusCanSaveReceipt?: boolean; VochusSaveReceipt?: { postMessage: (s: string) => void } }
  if (w.__vochusCanSaveReceipt && w.VochusSaveReceipt) {
    w.VochusSaveReceipt.postMessage(JSON.stringify({ data: dataUrl, filename }))
    return
  }
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}
