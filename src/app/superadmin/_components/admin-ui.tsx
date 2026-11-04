'use client'
// Shared building blocks for super admin pages. Styles live in ../admin.css.

import { isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icons, type IconName } from '@/components/ui/icons'

export const naira = (n: number | null | undefined) => `₦${Math.round(n ?? 0).toLocaleString('en-NG')}`
export const nairaKobo = (n: number | null | undefined) => `₦${(n ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const shortDate = (iso: string | Date) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
export const dateTime = (iso: string | Date) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()

/** Page title, one-line description and optional actions on the right. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pg-hd">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="pg-hd-actions">{actions}</div>}
    </div>
  )
}

export function Avatar({ name, photoUrl, tone = 'green' }: { name: string; photoUrl?: string | null; tone?: 'green' | 'amber' | 'red' | 'blue' | 'grey' }) {
  return (
    <span className={`av${tone === 'grey' ? '' : ` av-${tone}`}`} aria-hidden="true">
      {photoUrl ? <img src={photoUrl} alt="" /> : initialsOf(name)}
    </span>
  )
}

export function Empty({ icon = 'search', title, text, action, danger }: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode; danger?: boolean }) {
  const Icon = Icons[icon]
  return (
    <div className={`a-empty${danger ? ' is-danger' : ''}`}>
      <span className="a-empty-ic"><Icon size={22} aria-hidden="true" /></span>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action && <div className="a-empty-actions">{action}</div>}
    </div>
  )
}

/** Error state with a retry button, for a whole section that failed to load. */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return (
    <div role="alert">
      <Empty icon="error" danger title={offline ? 'You’re offline' : `We couldn’t load ${what}`}
        text={offline ? 'Reconnect to the internet, then try again.' : 'Something went wrong on our side or with the connection. Your data is safe.'}
        action={<button type="button" className="btn btn-outline" onClick={onRetry}><Icons.retry size={16} aria-hidden="true" /> Try again</button>} />
    </div>
  )
}

/** One-line error for a part of a page (the rest still works). */
export function InlineError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <p className="a-inline-error" role="alert">
      <Icons.error size={16} aria-hidden="true" />
      <span>{text}</span>
      {onRetry && <button type="button" className="card-link" onClick={onRetry}>Try again</button>}
    </p>
  )
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="a-tbl-skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="a-tbl-skel-row">
          <span className="skel a-tbl-skel-av" />
          {Array.from({ length: cols - 1 }, (_, c) => <span key={c} className="skel" style={{ width: `${c === 0 ? 30 : 14}%` }} />)}
        </div>
      ))}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="a-search">
      <Icons.search size={18} aria-hidden="true" />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label} autoComplete="off" />
      {value && <button type="button" className="a-search-clear" onClick={() => onChange('')} aria-label="Clear search"><Icons.close size={16} aria-hidden="true" /></button>}
    </label>
  )
}

/** Pill filter group. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  return (
    <nav className="a-pager" aria-label="Pages">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-NG')}</span>
      <div>
        <button type="button" className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icons.back size={16} aria-hidden="true" /></button>
        <span aria-current="page">Page {page} of {pages}</span>
        <button type="button" className="btn btn-outline btn-sm" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icons.next size={16} aria-hidden="true" /></button>
      </div>
    </nav>
  )
}

/** Debounced copy of a value — for search boxes that hit the API. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

type ToastTone = 'success' | 'error' | 'info'
type ToastMsg = { text: string; tone: ToastTone }

/**
 * `const [toastNode, toast] = useToast()` — render toastNode once, call toast('…') for a neutral
 * note, toast('…', 'success') or toast('…', 'error') to add a matching icon.
 */
export function useToast(): [ReactNode, (msg: string, tone?: ToastTone) => void] {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    setMsg({ text, tone })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), tone === 'error' ? 7000 : 4500)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const Icon = msg?.tone === 'success' ? Icons.check : msg?.tone === 'error' ? Icons.error : null
  return [
    <div key="toast" className={`a-toast${msg ? ' show' : ''}${msg ? ` is-${msg.tone}` : ''}`} role={msg?.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {Icon && <span className="a-toast-ic" aria-hidden="true"><Icon size={14} /></span>}
      <span>{msg?.text}</span>
    </div>,
    show,
  ]
}

export type DialogTone = 'neutral' | 'money' | 'danger' | 'success'

/**
 * Dialog: a header bar (optional back button and icon chip, title, close), a scrolling body and a
 * tinted footer for actions with an optional footnote on the left. Centred on desktop, a bottom
 * sheet on phones. Escape and the backdrop close it (unless `busy`); focus moves in on open and
 * back to the opener on close. `error` shows a banner at the top of the body and scrolls to it.
 */
export function Modal({ title, sub, onClose, onBack, children, footer, footnote, icon, tone = 'neutral', error, size = 'md', busy }: {
  title: string; sub?: ReactNode; onClose: () => void; onBack?: () => void; children: ReactNode
  footer?: ReactNode; footnote?: ReactNode; icon?: IconName; tone?: DialogTone; error?: ReactNode; size?: 'md' | 'lg'; busy?: boolean
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Captured during the first render, before any autoFocus inside the dialog moves focus.
  const openerRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const opener = openerRef.current
    // Respect a field the page focused with autoFocus; otherwise focus the first empty field.
    if (!ref.current?.contains(document.activeElement)) {
      const fields = Array.from(ref.current?.querySelectorAll<HTMLInputElement>('.a-modal-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .a-modal-content select, .a-modal-content textarea') ?? [])
      ;(fields.find(f => !f.value) ?? fields[0] ?? ref.current)?.focus()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) closeRef.current() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; opener?.focus?.() }
  }, [])

  useEffect(() => { if (error) bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [error])

  const Icon = icon ? Icons[icon] : null
  return (
    <div className="a-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={ref} className={`a-modal${size === 'lg' ? ' a-modal--lg' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={sub ? `${id}-s` : undefined} tabIndex={-1}>
        <div className="a-modal-hd">
          {onBack && <button type="button" className="a-modal-icon-btn" onClick={onBack} disabled={busy} aria-label="Back"><Icons.back size={18} aria-hidden="true" /></button>}
          {Icon && <span className={`a-modal-chip is-${tone}`} aria-hidden="true"><Icon size={18} /></span>}
          <div className="a-modal-titles">
            <h2 id={`${id}-t`}>{title}</h2>
            {sub && <div className="a-modal-sub" id={`${id}-s`}>{sub}</div>}
          </div>
          <button type="button" className="a-modal-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><Icons.close size={18} aria-hidden="true" /></button>
        </div>
        <div className="a-modal-content" ref={bodyRef}>
          {error && <DialogAlert>{error}</DialogAlert>}
          {children}
        </div>
        {(footer || footnote) && (
          <div className="a-modal-ft">
            {footnote && <div className="a-modal-footnote">{footnote}</div>}
            {footer && <div className="a-modal-actions">{footer}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Yes/no confirmation for consequential actions. Pass `icon`/`tone` to override the default chip. */
export function ConfirmModal({ title, body, confirmLabel, danger, busy, error, onConfirm, onClose, icon, tone, footnote }: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string
  onConfirm: () => void; onClose: () => void; icon?: IconName; tone?: DialogTone; footnote?: ReactNode
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy} error={error} footnote={footnote}
      icon={icon ?? (danger ? 'report' : undefined)} tone={tone ?? (danger ? 'danger' : 'neutral')}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-green'}`} onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? <><span className="a-spin" aria-hidden="true" /> Working…</> : confirmLabel}
        </button>
      </>}>
      <div className="a-confirm-body">{body}</div>
    </Modal>
  )
}

/** Error banner inside a dialog: what went wrong and, ideally, what to do. */
export function DialogAlert({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="dlg-alert" role="alert">
      <Icons.error size={18} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  )
}

/** Big amount at the top of a money dialog. */
export function AmountHero({ label, amount, sub, children }: { label: string; amount: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dlg-hero">
      <div className="dlg-hero-lbl">{label}</div>
      <div className="dlg-hero-amt">{amount}</div>
      {sub && <div className="dlg-hero-sub">{sub}</div>}
      {children && <div className="dlg-hero-extra">{children}</div>}
    </div>
  )
}

/** Label/value rows in a grey inset. Use `total` on the last row of a sum. */
export function Ledger({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <>
      {title && <h3 className="dlg-sec-h">{title}</h3>}
      <dl className="dlg-ledger">{children}</dl>
    </>
  )
}
export function LedgerRow({ label, children, total, strong }: { label: ReactNode; children: ReactNode; total?: boolean; strong?: boolean }) {
  return <div className={total ? 'is-total' : undefined}><dt>{label}</dt><dd className={strong ? 'dlg-strong' : undefined}>{children}</dd></div>
}

/** Short note under a summary: consequences, what happens next. */
export function DialogNote({ children, warn }: { children: ReactNode; warn?: boolean }) {
  const Icon = warn ? Icons.report : Icons.pending
  return <p className={`dlg-note${warn ? ' is-warn' : ''}`}><Icon size={16} aria-hidden="true" /><span>{children}</span></p>
}

/** Success view to show inside a dialog after an action completes. `pending` = accepted but not finished yet. */
export function DialogDone({ title, children, pending }: { title: string; children?: ReactNode; pending?: boolean }) {
  const Icon = pending ? Icons.pending : Icons.check
  return (
    <div className={`dlg-done${pending ? ' is-pending' : ''}`} role="status">
      <span className="dlg-done-ic" aria-hidden="true"><Icon size={28} /></span>
      <h3>{title}</h3>
      {children && <div className="dlg-done-body">{children}</div>}
    </div>
  )
}

export type ResultRow = { label: string; value: ReactNode; total?: boolean }
export type Result = { heading: string; title: string; text?: ReactNode; rows?: ResultRow[]; pending?: boolean }

/** The dialog shown after a money action succeeds: what happened, with a short receipt. */
export function ResultModal({ result, onClose }: { result: Result; onClose: () => void }) {
  return (
    <Modal title={result.heading} onClose={onClose}
      footnote={<><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</>}
      footer={<button type="button" className="btn btn-green" onClick={onClose}>Done</button>}>
      <DialogDone title={result.title} pending={result.pending}>
        {result.text}
        {result.rows && result.rows.length > 0 && (
          <Ledger>{result.rows.map(r => <LedgerRow key={r.label} label={r.label} total={r.total}>{r.value}</LedgerRow>)}</Ledger>
        )}
      </DialogDone>
    </Modal>
  )
}

type MenuItem = { label: string; onSelect?: () => void; danger?: boolean; href?: string }

/**
 * Small "⋯" menu for secondary row actions. The list is positioned against the viewport, so a
 * scrolling table can't clip it, and opens upwards when there's no room below.
 */
export function RowMenu({ label, items }: { label: string; items: (MenuItem | false | null | undefined)[] }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right?: number; left?: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const list = items.filter(Boolean) as MenuItem[]
  const open = pos !== null

  function toggle() {
    if (open) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Line the menu's right edge up with the button; when the button sits near the left edge
    // (stacked mobile cards) that would push the menu off-screen, so line up the left edge instead.
    const side = r.right < 232 ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) }
    const roomBelow = window.innerHeight - r.bottom
    setPos(roomBelow < list.length * 44 + 24 ? { bottom: window.innerHeight - r.top + 6, ...side } : { top: r.bottom + 6, ...side })
  }

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') { setPos(null); btnRef.current?.focus() } return }
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      setPos(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  if (list.length === 0) return null
  return (
    <div className="a-rowmenu" ref={ref}>
      <button ref={btnRef} type="button" className="a-rowmenu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <Icons.more size={18} aria-hidden="true" />
      </button>
      {pos && (
        <div className="a-rowmenu-list" role="menu" style={pos}>
          {list.map(i => i.href
            ? <a key={i.label} role="menuitem" href={i.href} className={i.danger ? 'is-danger' : ''}>{i.label}</a>
            : <button key={i.label} type="button" role="menuitem" className={i.danger ? 'is-danger' : ''} onClick={() => { setPos(null); i.onSelect?.() }}>{i.label}</button>)}
        </div>
      )}
    </div>
  )
}

const INSET = new Set(['input', 'select', 'textarea'])
/** Wrappers that add a ₦ prefix or % suffix around one input. */
const AFFIX = /(^|\s)(am-money|cm-money|ag-money|am-pct|lo-affix)(\s|$)/

/**
 * A labelled field for admin forms. A single input/select/textarea child gets the filled style
 * with the label inside the box; anything else (prefixed money inputs, input + button) keeps the
 * label above.
 */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  const el = isValidElement<{ className?: string }>(children) && typeof children.type === 'string' ? children : null
  const inset = !!el && (INSET.has(el.type as string) || (el.type === 'div' && AFFIX.test(el.props.className ?? '')))
  const message = error
    ? <p className="a-field-error" id={`${id}-error`} role="alert"><Icons.error size={14} aria-hidden="true" /> {error}</p>
    : hint ? <p className="a-hint" id={`${id}-hint`}>{hint}</p> : null
  return (
    <div className={`a-field${error ? ' is-invalid' : ''}${inset ? ' is-inset' : ''}`}>
      {inset ? (
        <div className="a-tf">
          <label className="a-tf-label" htmlFor={id}>{label}</label>
          {children}
        </div>
      ) : (
        <>
          <label className="a-label" htmlFor={id}>{label}</label>
          {children}
        </>
      )}
      {message}
    </div>
  )
}
