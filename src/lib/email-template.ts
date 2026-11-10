// One layout for the emails that use it: logo, heading, amount, details and footer.
// Table-based with inline styles, because email clients ignore most modern CSS.
import { emailLogo } from '@/lib/email-brand'
import { escapeHtml as e } from '@/lib/escape-html'

export type EmailTone = 'success' | 'warning' | 'danger'

/** Label, value, and 'strong' for the one figure that matters. A row with an empty value is dropped. */
export type EmailRow = [string, string | null | undefined, 'strong'?]

export type EmailContent = {
  subject: string
  preheader: string
  tone: EmailTone
  /** Short status above the heading. Leave empty when the heading already says it. */
  statusLabel: string
  heading: string
  intro?: string
  amount?: string
  amountLabel?: string
  banner?: boolean
  rows: EmailRow[]
  /** Small print after the details. */
  note?: string
  /** Why something happened, given full width above the details. */
  reason?: { label: string; text: string }
  /** What to do now. Sits above the details, with the button. */
  nextStep?: string
  /** A one-time code, shown large. Add an action only when the code can't be used without that link. */
  code?: { value: string; caption?: string }
  /** One button, only to a real page. */
  action?: { label: string; url: string }
  /** Two-line rows: who or what on the left, the figure on the right. */
  list?: { primary: string; secondary?: string; value: string }[]
  /** A short bulleted list after the details, such as tips for next time. */
  tips?: { title: string; items: string[] }
  /** Nothing to verify, like a weekly summary: the footer just offers help. */
  routine?: boolean
  /** Sets the footer's help line. */
  audience?: 'customer' | 'agent' | 'staff'
}

const SUPPORT = 'support@vochuseasysave.com'
const TONE: Record<EmailTone, string> = { success: '#146C34', warning: '#8A5A00', danger: '#A8281C' }
const BRAND = '#17783A'
const DEEP = '#0F2A1D'
const INK = '#14241B'
const BODY = '#47544C'
const MUTED = '#66736B'
const FOOT = '#56635B'
const LINE = '#E7EAE6'
const PAGE = '#F3F4F1'
const TINT = '#F3F6F2'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,Menlo,Consolas,'Courier New',monospace"
/** Past this length a value is a sentence, so it gets the full width instead of a column. */
const LONG_VALUE = 34
const CODE_SPACING = 9
const CODE_SPACING_PHONE = 6

// Inline styles do the real work. This block only adds what inline styles can't: narrow screens and dark mode.
const HEAD_CSS =
  `:root{color-scheme:light dark;supported-color-schemes:light dark}` +
  `a{color:${BRAND}}` +
  `@media only screen and (max-width:480px){` +
  `.outer{padding:0 0 24px!important}.card{border-radius:0!important}` +
  `.px{padding-left:24px!important;padding-right:24px!important}` +
  `.band{padding:22px 20px 24px!important}` +
  `.h1{font-size:25px!important;line-height:31px!important}` +
  `.amt{font-size:38px!important;line-height:44px!important}.amt-minor{font-size:22px!important}` +
  `.code{font-size:32px!important;letter-spacing:${CODE_SPACING_PHONE}px!important;padding-left:${CODE_SPACING_PHONE}px!important}` +
  `.btn{width:100%!important}.btn a{display:block!important;text-align:center!important}` +
  `}` +
  `@media (prefers-color-scheme:dark){` +
  `.page{background:#0E1310!important}.card{background:#1A211D!important}` +
  `.ink{color:#F1F5F2!important}.body{color:#C5CFC9!important}.muted{color:#A3AFA8!important}` +
  `.line{border-color:#2E3833!important}.tint{background:#232C27!important}` +
  `.deep{background:#1F4D33!important}` +
  // The logo's dark blue needs a white tile on a dark card. Only here, so it stays aligned with the heading in light mode.
  `.logo-tile{background:#ffffff!important;padding:4px!important;border-radius:10px!important}` +
  `.t-success{color:#7BD3A0!important}.t-warning{color:#F0BC6A!important}.t-danger{color:#F4978E!important}` +
  `.code{color:#F1F5F2!important}` +
  `}`

/** Shows ".00" smaller than the naira figure. */
function amountHtml(amount: string, color: string, cls: string): string {
  const dot = amount.lastIndexOf('.')
  if (dot === -1) return e(amount)
  return `${e(amount.slice(0, dot))}<span class="amt-minor ${cls}" style="font-size:26px;font-weight:700;color:${color}">${e(amount.slice(dot))}</span>`
}

function footerHelp(c: EmailContent): string {
  const link = `<a class="muted" href="mailto:${SUPPORT}" style="color:${FOOT};text-decoration:underline">${SUPPORT}</a>`
  // Say it once: a note that already gives the address doesn't need the footer repeating it.
  if (c.audience === 'staff' || c.note?.includes(SUPPORT)) return ''
  if (c.code || c.action || c.list?.length || c.routine) return `Need help? Write to ${link}.<br>`
  return c.audience === 'agent'
    ? `If you don't recognise this, write to ${link} right away.<br>`
    : `If you don't recognise this, contact your agent or write to ${link} right away.<br>`
}

export function renderEmail(c: EmailContent): string {
  const rows = c.rows.filter((r): r is [string, string, 'strong'?] => typeof r[1] === 'string' && r[1].trim() !== '')
  const px = 'padding-left:40px;padding-right:40px'
  const section = (html: string, top = 0) => `<tr><td class="px" style="${px};padding-top:${top}px">${html}</td></tr>`
  const table = (inner: string, cls = '') => `<table role="presentation"${cls ? ` class="${cls}"` : ''} width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>`

  const brand =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="logo-tile" style="line-height:0">${emailLogo(32)}</td>` +
    `<td class="ink" style="padding-left:10px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};vertical-align:middle">Vochus Easy Save</td>` +
    `</tr></table>`

  const status = c.statusLabel.trim() !== '' && !c.banner
    ? `<div class="t-${c.tone}" style="font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${TONE[c.tone]};padding-bottom:10px">${e(c.statusLabel)}</div>`
    : ''

  const intro = c.intro
    ? `<p class="body" style="margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:26px;color:${BODY}">${e(c.intro)}</p>`
    : ''

  const plainAmount = c.amount && !c.banner
    ? section(
        (c.amountLabel ? `<div class="muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}">${e(c.amountLabel)}</div>` : '') +
          `<div class="amt ink" style="font-family:${FONT};font-size:44px;line-height:52px;font-weight:700;letter-spacing:-0.5px;color:${INK}">${amountHtml(c.amount, INK, 'ink')}</div>`,
        28,
      )
    : ''

  const banner = c.amount && c.banner
    ? section(
        // Inset, so its edges line up with the heading and details above and below it.
        table(
          `<tr><td class="deep band" bgcolor="${DEEP}" style="background:${DEEP};border-radius:14px;padding:26px 28px 28px">` +
            (c.amountLabel ? `<div style="font-family:${FONT};font-size:15px;line-height:22px;color:#CFE3D6">${e(c.amountLabel)}</div>` : '') +
            `<div class="amt" style="font-family:${FONT};font-size:44px;line-height:52px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;padding-top:4px">${amountHtml(c.amount, '#ffffff', '')}</div>` +
            `</td></tr>`,
        ),
        28,
      )
    : ''

  const code = c.code
    ? section(
        table(
          `<tr><td class="tint" bgcolor="${TINT}" align="center" style="background:${TINT};border-radius:14px;padding:26px 12px">` +
            // Letter spacing adds a gap after the last digit, so the same gap goes before the first to keep it centred.
            `<div class="code" style="font-family:${MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:${CODE_SPACING}px;padding-left:${CODE_SPACING}px;color:${DEEP};word-break:break-all">${e(c.code.value)}</div>` +
            `</td></tr>`,
        ) +
          (c.code.caption ? `<div class="muted" style="font-family:${FONT};font-size:14px;line-height:22px;color:${MUTED};padding-top:14px">${e(c.code.caption)}</div>` : ''),
        28,
      )
    : ''

  const reason = c.reason
    ? section(
        table(
          `<tr><td class="tint" bgcolor="${TINT}" style="background:${TINT};border-radius:14px;padding:18px 20px">` +
            `<div class="muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}">${e(c.reason.label)}</div>` +
            `<div class="ink" style="font-family:${FONT};font-size:16px;line-height:24px;color:${INK};padding-top:4px">${e(c.reason.text)}</div>` +
            `</td></tr>`,
        ),
        24,
      )
    : ''

  const nextStep = c.nextStep
    ? section(`<div class="body" style="font-family:${FONT};font-size:16px;line-height:26px;color:${BODY}">${e(c.nextStep)}</div>`, 18)
    : ''

  const button = c.action
    ? section(
        `<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0"><tr>` +
          `<td bgcolor="${BRAND}" align="center" style="background:${BRAND};border-radius:12px;mso-padding-alt:15px 30px">` +
          `<a href="${e(c.action.url)}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:600;color:#ffffff;text-decoration:none">${e(c.action.label)}</a>` +
          `</td></tr></table>`,
        24,
      )
    : ''

  const list = c.list?.length
    ? section(
        table(
          c.list.map((item, i) => {
            const b = i ? `border-top:1px solid ${LINE};` : ''
            return `<tr><td class="line" style="${b}padding:14px 16px 14px 0;vertical-align:top">` +
              `<div class="ink" style="font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${INK}">${e(item.primary)}</div>` +
              (item.secondary ? `<div class="muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};word-break:break-word;white-space:pre-line">${e(item.secondary)}</div>` : '') +
              `</td><td class="ink line" align="right" style="${b}padding:14px 0;vertical-align:top;font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${INK};white-space:nowrap">${e(item.value)}</td></tr>`
          }).join(''),
        ),
        20,
      )
    : ''

  const details = rows.length
    ? section(
        table(
          rows.map(([label, value, weight], i) => {
            const b = i ? `border-top:1px solid ${LINE};` : ''
            const valueWeight = weight === 'strong' ? 700 : 400
            if (value.length > LONG_VALUE) {
              return `<tr><td colspan="2" class="line" style="${b}padding:14px 0">` +
                `<div class="muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}">${e(label)}</div>` +
                `<div class="ink" style="font-family:${FONT};font-size:14px;line-height:22px;font-weight:${valueWeight};color:${INK};padding-top:2px;word-break:break-word">${e(value)}</div></td></tr>`
            }
            return `<tr><td class="muted line" style="${b}padding:14px 16px 14px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};vertical-align:top;white-space:nowrap">${e(label)}</td>` +
              `<td class="ink line" style="${b}padding:14px 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:${valueWeight};color:${INK};text-align:right;vertical-align:top;word-break:break-word">${e(value)}</td></tr>`
          }).join(''),
        ),
        c.banner ? 14 : 22,
      )
    : ''

  const note = c.note
    ? section(`<div class="body" style="font-family:${FONT};font-size:14px;line-height:22px;color:${BODY}">${e(c.note)}</div>`, 22)
    : ''

  const tips = c.tips?.items.length
    ? section(
        `<div class="ink" style="font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:${INK}">${e(c.tips.title)}</div>` +
          table(
            c.tips.items.map((item) =>
              `<tr><td class="muted" style="padding:8px 10px 0 0;vertical-align:top;width:10px;font-family:${FONT};font-size:15px;line-height:24px;color:${MUTED}">&bull;</td>` +
              `<td class="body" style="padding-top:8px;vertical-align:top;font-family:${FONT};font-size:15px;line-height:24px;color:${BODY}">${e(item)}</td></tr>`,
            ).join(''),
          ),
        26,
      )
    : ''

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<meta name="x-apple-disable-message-reformatting"><title>${e(c.subject)}</title><style>${HEAD_CSS}</style></head>` +
    `<body class="page" style="margin:0;padding:0;background:${PAGE}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${e(c.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>` +
    `<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td class="outer" align="center" style="padding:32px 12px 40px">` +
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">` +
    `<tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border-radius:18px;padding:0 0 38px;overflow:hidden">` +
    table(
      section(brand, 34) +
        section(
          status + `<h1 class="h1 ink" style="margin:0;font-family:${FONT};font-size:30px;line-height:37px;font-weight:700;letter-spacing:-0.3px;color:${INK}">${e(c.heading)}</h1>` + intro,
          36,
        ) +
        plainAmount + banner + code + reason + nextStep + button + list + details + tips + note,
    ) +
    `</td></tr>` +
    `<tr><td class="muted foot" align="center" style="padding:22px 24px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${FOOT}">${footerHelp(c)}Vochus Easy Save &middot; Zipwaves Technologies Limited</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`
  )
}

/** Subject and HTML together, ready to spread into sendMail. */
export function emailMessage(c: EmailContent): { subject: string; html: string } {
  return { subject: c.subject, html: renderEmail(c) }
}

type CodeEmail = Pick<EmailContent, 'subject' | 'preheader' | 'heading' | 'intro' | 'action' | 'note' | 'audience'> & {
  code: string
  /** How long it lasts and who may see it. */
  caption: string
  rows?: EmailRow[]
}

/** Every email carrying a one-time code. The preheader shows in the inbox, so it must never contain the code. */
export function codeEmailMessage({ code, caption, rows, ...c }: CodeEmail): { subject: string; html: string } {
  return emailMessage({ ...c, tone: 'success', statusLabel: '', rows: rows ?? [], code: { value: code, caption } })
}
