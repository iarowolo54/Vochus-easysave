import { emailLogo } from '@/lib/email-brand'
import { escapeHtml } from '@/lib/escape-html'

export type EmailTone = 'success' | 'warning' | 'danger'

export type EmailContent = {
  /** Subject line and the hidden preview text shown beside it in the inbox. */
  subject: string
  preheader: string
  tone: EmailTone
  /** Short status pill above the amount, e.g. "Paid". */
  statusLabel: string
  heading: string
  /** Plain text; escaped here. */
  intro: string
  /** The headline figure, already formatted, e.g. "₦12,500.00". */
  amount?: string
  amountLabel?: string
  /** Label / value pairs. A row with an empty value is dropped. Values are plain text and escaped here. */
  rows: [string, string | null | undefined][]
  /** An extra line under the details, e.g. what happens next. */
  note?: string
}

const TONES: Record<EmailTone, { pillBg: string; pillInk: string; accent: string }> = {
  success: { pillBg: '#e7f3ea', pillInk: '#146c34', accent: '#146c34' },
  warning: { pillBg: '#fdf1dc', pillInk: '#8a5a00', accent: '#b36b00' },
  danger: { pillBg: '#fbe6e4', pillInk: '#a8281c', accent: '#a8281c' },
}

const INK = '#0f2a1d'
const MUTED = '#5e6b64'
const LINE = '#e6e6eb'
const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const e = escapeHtml

/**
 * One layout for every payout email: logo, status, amount, a details table and a footer.
 * Table-based with inline styles, because email clients ignore most modern CSS.
 */
export function renderEmail(c: EmailContent): string {
  const t = TONES[c.tone]
  const rows = c.rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '')
  const rowsHtml = rows
    .map(
      ([label, value], i) =>
        `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-size:13px;color:${MUTED};vertical-align:top;width:40%">${e(label)}</td>` +
        `<td style="padding:12px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-size:14px;font-weight:600;color:${INK};text-align:right;vertical-align:top;word-break:break-word">${e(value)}</td></tr>`,
    )
    .join('')
  const amountHtml = c.amount
    ? `${c.amountLabel ? `<div style="margin-top:18px;font-size:13px;color:${MUTED}">${e(c.amountLabel)}</div>` : ''}` +
      `<div style="margin-top:${c.amountLabel ? 4 : 18}px;font-size:34px;line-height:40px;font-weight:700;color:${INK}">${e(c.amount)}</div>`
    : ''

  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(c.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f3f1;font-family:${FONT}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(c.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f1"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:middle">${emailLogo(40)}</td>` +
    `<td style="vertical-align:middle;padding-left:10px;font-size:16px;font-weight:700;color:${INK}">Vochus Easy Save</td></tr></table></td></tr>` +
    `<tr><td style="background:#ffffff;border-radius:16px;padding:28px 24px">` +
    `<div><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${t.pillBg};color:${t.pillInk};font-size:12px;font-weight:700">${e(c.statusLabel)}</span></div>` +
    `<h1 style="margin:14px 0 0;font-size:22px;line-height:28px;font-weight:700;color:${INK}">${e(c.heading)}</h1>` +
    `<p style="margin:10px 0 0;font-size:15px;line-height:22px;color:${MUTED}">${e(c.intro)}</p>` +
    amountHtml +
    (rowsHtml
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:2px solid ${t.accent}">${rowsHtml}</table>`
      : '') +
    (c.note
      ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#f6f7f5;font-size:13px;line-height:20px;color:${MUTED}">${e(c.note)}</div>`
      : '') +
    `</td></tr>` +
    `<tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:18px;color:${MUTED}">` +
    `Keep this email as your record. If you don't recognise this activity, contact your agent or Vochus Easy Save support right away.<br/>` +
    `Vochus Easy Save · Zipwaves Technologies Limited</td></tr>` +
    `</table></td></tr></table></body></html>`
  )
}
