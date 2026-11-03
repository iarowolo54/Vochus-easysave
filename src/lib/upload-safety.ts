// What an uploaded document may be, judged by its bytes. These files are served from our own origin to super admins,
// so anything that could run as a page (SVG, HTML) must never come back as itself: a stored script would run in the
// admin's session. The same rules apply when serving, because rows stored before this check may be anything.
import { contentDisposition } from '@/lib/content-disposition'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
type SafeType = (typeof TYPES)[number]

const EXTENSION: Record<SafeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }

// Some phones report no type, or a generic one, for a file picked from storage. The bytes decide those.
const UNLABELLED = ['', 'application/octet-stream']

const WRONG_TYPE = 'Please upload a JPEG, PNG, WebP or PDF file.'

/** The allowed type these bytes really are, or null. */
export function detectType(b: Buffer): SafeType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

function parseDataUrl(value: string): { mime: string; base64: string } | null {
  const m = value.match(/^data:([^;,]*);base64,(.*)$/)
  if (!m || !m[2] || !/^[A-Za-z0-9+/]+={0,2}$/.test(m[2])) return null
  const mime = m[1].toLowerCase()
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, base64: m[2] }
}

/** A name safe to store: no path, no control or quote characters, a sane length, and an extension matching the real type. */
export function safeFileName(fileName: string, type: SafeType): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').replace(/\.[^.]*$/, '').trim().slice(0, 100)
  return `${clean || 'document'}.${EXTENSION[type]}`
}

export type UploadCheck = { ok: true; fileName: string; fileData: string } | { ok: false; error: string }

export function validateUpload(fileName: unknown, fileData: unknown): UploadCheck {
  if (typeof fileName !== 'string' || typeof fileData !== 'string') return { ok: false, error: WRONG_TYPE }
  // From the length first, so an oversized blob is refused before it's scanned or decoded.
  if (Math.floor(((fileData.length - fileData.indexOf(',') - 1) * 3) / 4) > MAX_UPLOAD_BYTES + 2) return { ok: false, error: 'That file is over 5 MB. Take a smaller photo or compress the PDF.' }
  const parsed = parseDataUrl(fileData)
  if (!parsed) return { ok: false, error: WRONG_TYPE }
  const type = detectType(Buffer.from(parsed.base64, 'base64'))
  if (!type || (parsed.mime !== type && !UNLABELLED.includes(parsed.mime))) return { ok: false, error: WRONG_TYPE }
  return { ok: true, fileName: safeFileName(fileName, type), fileData: `data:${type};base64,${parsed.base64}` }
}

export type ServedFile = { body: Buffer; contentType: string; inline: boolean }

/** Only a row whose label and bytes agree on an allowed type opens in place. Anything else is a download of opaque bytes. */
export function serveStoredFile(fileData: string, fileName: string): ServedFile {
  const parsed = parseDataUrl(fileData)
  const body = Buffer.from(parsed?.base64 ?? fileData, 'base64')
  const type = detectType(body)
  // An older PDF stored with no real type still opens, as it always has.
  const unlabelledPdf = type === 'application/pdf' && UNLABELLED.includes(parsed?.mime ?? '') && /\.pdf$/i.test(fileName)
  if (type && parsed && (parsed.mime === type || unlabelledPdf)) return { body, contentType: type, inline: true }
  return { body, contentType: 'application/octet-stream', inline: false }
}

/** Headers for a stored file. These apply to every response, so a browser can never treat it as a page from our origin. */
export function storedFileHeaders(file: ServedFile, fileName: string): Record<string, string> {
  return {
    'Content-Type': file.contentType,
    'Content-Disposition': contentDisposition(file.inline ? 'inline' : 'attachment', fileName),
    'Cache-Control': 'private, max-age=0, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  }
}
