'use client'

import { isChatImage } from '@/lib/chat-image'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate } from '@/lib/format'

type Thread = {
  id: string; customerId: string; firstName: string; lastName: string
  /** The list API sends no photos (they made it slow); threads show coloured initials. */
  photoUrl?: string | null; unread: number; lastMessage: string | null; lastAt: string | null
}
type Msg = {
  id: string; sender: string; senderName: string | null; message: string; imageUrl?: string | null; createdAt: string
  /** Set on messages this screen is still sending, or failed to send. */
  local?: 'sending' | 'failed'
}
type Found = { id: string; customerId: string; firstName: string; lastName: string; photoUrl?: string | null; phone: string }

const POLL_MS = 5000
const initials = (f: string, l: string) => `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase()
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function dayLabel(iso: string) {
  const d = new Date(iso); const t = new Date()
  const y = new Date(); y.setDate(t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return formatDate(iso)
}
function listTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toDateString() === new Date().toDateString() ? time(iso) : dayLabel(iso)
}

function Avatar({ c, size }: { c: { customerId: string; firstName: string; lastName: string; photoUrl?: string | null }; size?: 'sm' }) {
  return c.photoUrl
    ? <img className={`ui-avatar ag-av ag-chat-av${size ? ' ag-chat-av--sm' : ''}`} src={c.photoUrl} alt="" />
    : <span className={`ui-avatar ag-av ag-av--${avatarTint(c.customerId)} ag-chat-av${size ? ' ag-chat-av--sm' : ''}`} aria-hidden="true">{initials(c.firstName, c.lastName)}</span>
}

export default function AgentChatPage() {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [sendError, setSendError] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const openRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const atBottom = useRef(true)
  const rootRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/customer-chat')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setThreads(data.customers ?? [])
      setListFailed(false)
    } catch {
      setListFailed(true)
      setThreads(prev => prev ?? [])
    }
  }, [])

  const loadMessages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agent/customer-chat?customerId=${id}`)
      if (!res.ok) return
      const data = await res.json()
      if (openRef.current !== id) return
      // Keep anything still sending or failed at the end; the server copy replaces the rest.
      setMessages(prev => [...(data.messages ?? []), ...(prev ?? []).filter(m => m.local)])
    } catch { /* The next poll tries again. */ }
  }, [])

  useEffect(() => {
    loadList()
    const iv = setInterval(() => {
      loadList()
      if (openRef.current) loadMessages(openRef.current)
    }, POLL_MS)
    return () => clearInterval(iv)
  }, [loadList, loadMessages])

  // Fill the screen from wherever the chat starts (the app banner above it may or may not be showing).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const phone = window.matchMedia('(max-width: 768px)').matches
      const below = phone && !open ? 64 + 24 : phone ? 0 : 32 // tab bar + gap on phones, page padding on desktop
      el.style.height = `${Math.max(420, window.innerHeight - top - below)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    const ro = new ResizeObserver(fit)
    ro.observe(document.body)
    return () => { window.removeEventListener('resize', fit); ro.disconnect() }
  }, [open])

  // Follow new messages only when the agent is already at the bottom, so reading older ones isn't interrupted.
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function openThread(t: Thread) {
    setOpen(t)
    openRef.current = t.id
    setMessages(null)
    setText(''); setImage(null); setSendError('')
    atBottom.current = true
    loadMessages(t.id)
    setThreads(prev => (prev ?? []).map(p => p.id === t.id ? { ...p, unread: 0 } : p))
    requestAnimationFrame(() => textRef.current?.focus())
  }

  function closeThread() {
    setOpen(null)
    openRef.current = null
    setMessages(null)
  }

  function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      // Shrink to at most 900px on the long side so photos send quickly on mobile data.
      const MAX = 900
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX } else { w = Math.round(w * MAX / h); h = MAX } }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
      setImage(canvas.toDataURL('image/jpeg', 0.75))
      URL.revokeObjectURL(url)
    }
    img.onerror = () => { setSendError('That image couldn’t be opened. Try another one.'); URL.revokeObjectURL(url) }
    img.src = url
  }

  async function send(retry?: Msg) {
    if (!open) return
    const body = retry ? { message: retry.message, imageUrl: retry.imageUrl ?? null } : { message: text.trim(), imageUrl: image }
    if (!body.message && !body.imageUrl) return
    const tempId = retry?.id ?? `local-${Date.now()}`
    const temp: Msg = { id: tempId, sender: 'agent', senderName: null, message: body.message, imageUrl: body.imageUrl, createdAt: new Date().toISOString(), local: 'sending' }
    setMessages(prev => [...(prev ?? []).filter(m => m.id !== tempId), temp])
    if (!retry) { setText(''); setImage(null) }
    setSendError('')
    atBottom.current = true
    try {
      const res = await fetch('/api/agent/customer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: open.id, ...body }),
      })
      if (!res.ok) throw new Error()
      setMessages(prev => (prev ?? []).filter(m => m.id !== tempId))
      await loadMessages(open.id)
      loadList()
    } catch {
      setMessages(prev => (prev ?? []).map(m => m.id === tempId ? { ...m, local: 'failed' } : m))
      setSendError('A message didn’t send. Tap it to try again.')
    }
  }

  function startWith(c: Found) {
    setNewOpen(false)
    const existing = (threads ?? []).find(t => t.id === c.id)
    openThread(existing ?? { id: c.id, customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, photoUrl: c.photoUrl ?? null, unread: 0, lastMessage: null, lastAt: null })
  }

  const q = query.trim().toLowerCase()
  const shown = (threads ?? [])
    .filter(t => !q || `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) || t.customerId.toLowerCase().includes(q))
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
  const unreadTotal = (threads ?? []).reduce((s, t) => s + t.unread, 0)
  const canSend = !!(text.trim() || image)
  const first = open ? displayName(open.firstName) : ''

  return (
    <div ref={rootRef} className={`ag-chat${open ? ' is-open' : ''}`}>
      <aside className="ag-chat-list" aria-label="Conversations">
        <div className="ag-chat-list-head">
          <h2>Messages{unreadTotal > 0 && <span className="ag-chat-unread" aria-label={`${unreadTotal} unread`}>{unreadTotal}</span>}</h2>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => setNewOpen(true)}><Icons.add size={18} aria-hidden="true" /> New</button>
        </div>
        {threads && threads.length > 0 && (
          <div className="ag-search ag-chat-search">
            <Icons.search size={18} aria-hidden="true" />
            <input className="ui-input" type="search" autoComplete="off" placeholder="Search by name or ID" aria-label="Search conversations" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
        <div className="ag-chat-scroll">
          {threads === null ? (
            <ListSkeleton count={5} />
          ) : listFailed && threads.length === 0 ? (
            <EmptyState icon="error" tone="danger" title="Couldn’t load messages" text="Check your connection. We’ll keep trying."
              action={<button type="button" className="ui-btn ui-btn--secondary" onClick={loadList}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
          ) : threads.length === 0 ? (
            <EmptyState icon="chat" title="No messages yet" text="When customers message you, their chats show here. You can also start one."
              action={<button type="button" className="ui-btn ui-btn--primary" onClick={() => setNewOpen(true)}><Icons.add size={18} aria-hidden="true" /> New message</button>} />
          ) : shown.length === 0 ? (
            <p className="ag-chat-none">No one matches “{query}”.</p>
          ) : (
            shown.map(t => (
              <button key={t.id} type="button" className={`ag-chat-thread${open?.id === t.id ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}`} onClick={() => openThread(t)} aria-current={open?.id === t.id ? 'true' : undefined}>
                <Avatar c={t} />
                <span className="ag-chat-thread-main">
                  <span className="ag-chat-thread-top">
                    <span className="ag-chat-thread-name">{displayName(`${t.firstName} ${t.lastName}`)}</span>
                    <span className="ag-chat-thread-time">{listTime(t.lastAt)}</span>
                  </span>
                  <span className="ag-chat-thread-bottom">
                    <span className="ag-chat-thread-last">{t.lastMessage?.startsWith('📷') ? 'Photo' : t.lastMessage || 'No messages yet'}</span>
                    {t.unread > 0 && <span className="ag-chat-unread" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="ag-chat-convo" aria-label={open ? `Chat with ${first}` : 'Conversation'}>
        {!open ? (
          <div className="ag-chat-blank">
            <span className="ag-chat-blank-icon" aria-hidden="true"><Icons.chat size={28} /></span>
            <p className="ui-row-title">Choose a conversation</p>
            <p className="ui-row-sub">Or start a new one with any of your customers.</p>
          </div>
        ) : (
          <>
            <header className="ag-chat-head">
              <button type="button" className="ui-icon-btn ui-icon-btn--soft ag-chat-back" aria-label="Back to messages" onClick={closeThread}><Icons.back size={20} aria-hidden="true" /></button>
              <Avatar c={open} size="sm" />
              <div className="ag-chat-head-main">
                <p className="ui-row-title">{displayName(`${open.firstName} ${open.lastName}`)}</p>
                <p className="ui-row-sub">{open.customerId}</p>
              </div>
              <Link href={`/dashboard/savings?cid=${encodeURIComponent(open.customerId)}`} className="ui-btn ui-btn--secondary ui-btn--sm"><Icons.add size={16} aria-hidden="true" /> Record saving</Link>
            </header>

            <div className="ag-chat-msgs" ref={scrollRef} onScroll={e => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }} aria-live="polite">
              {messages === null ? (
                <div className="ag-chat-loading"><span className="ui-spinner" aria-label="Loading messages" /></div>
              ) : messages.length === 0 ? (
                <p className="ag-chat-none">No messages yet. Say hello to {first}.</p>
              ) : (
                messages.map((m, i) => {
                  const mine = m.sender === 'agent'
                  const newDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(m.createdAt)
                  return (
                    <div key={m.id}>
                      {newDay && <p className="ag-chat-day"><span>{dayLabel(m.createdAt)}</span></p>}
                      <div className={`ag-msg${mine ? ' is-mine' : ''}${m.local === 'failed' ? ' is-failed' : ''}`}>
                        <div className="ag-msg-bubble" {...(m.local === 'failed' ? { role: 'button', tabIndex: 0, onClick: () => send(m), onKeyDown: e => { if (e.key === 'Enter') send(m) } } : {})}>
                          {isChatImage(m.imageUrl) && (
                            <a href={m.imageUrl} target="_blank" rel="noreferrer" className="ag-msg-img" onClick={e => { if (m.local) e.preventDefault() }}>
                              <img src={m.imageUrl} alt={mine ? 'Photo you sent' : `Photo from ${first}`} />
                            </a>
                          )}
                          {m.message && <p className="ag-msg-text">{m.message}</p>}
                        </div>
                        <p className="ag-msg-meta">
                          {m.local === 'sending' ? 'Sending…' : m.local === 'failed' ? <><Icons.error size={12} aria-hidden="true" /> Not sent · tap to retry</> : time(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {sendError && <p className="ag-chat-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {sendError}</p>}
            {image && (
              <div className="ag-chat-preview">
                <img src={image} alt="Photo to send" />
                <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Remove photo" onClick={() => setImage(null)}><Icons.close size={16} aria-hidden="true" /></button>
              </div>
            )}
            <div className="ag-chat-compose">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
              <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Add a photo" onClick={() => fileRef.current?.click()}><Icons.image size={20} aria-hidden="true" /></button>
              <textarea ref={textRef} className="ag-chat-input" rows={1} maxLength={2000} placeholder={`Message ${first}…`} aria-label={`Message ${first}`}
                value={text}
                onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px` }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); if (canSend) send() } }} />
              <button type="button" className="ag-chat-send" aria-label="Send" disabled={!canSend} onClick={() => send()}><Icons.send size={20} aria-hidden="true" /></button>
            </div>
          </>
        )}
      </section>

      <NewMessageSheet open={newOpen} onClose={() => setNewOpen(false)} onPick={startWith} />
    </div>
  )
}

/** Search your customers and open a chat with one. */
function NewMessageSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Found) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Found[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) { setQ(''); setResults(null); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?limit=20${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ''}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error()
        const d = await res.json()
        setResults(d.customers ?? []); setFailed(false)
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') setFailed(true)
      }
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [open, q])

  return (
    <BottomSheet open={open} onClose={onClose} title="New message">
      <div className="ag-search ag-chat-search">
        <Icons.search size={18} aria-hidden="true" />
        <input className="ui-input" type="search" autoComplete="off" placeholder="Name, phone or customer ID" aria-label="Find a customer" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="ag-chat-pick">
        {failed ? (
          <p className="ag-chat-none">Couldn’t search right now. Check your connection.</p>
        ) : results === null ? (
          <ListSkeleton count={4} />
        ) : results.length === 0 ? (
          <p className="ag-chat-none">{q ? `No customers match “${q}”.` : 'You don’t have any customers yet.'}</p>
        ) : (
          results.map(c => (
            <button key={c.id} type="button" className="ag-chat-thread" onClick={() => onPick(c)}>
              <Avatar c={c} />
              <span className="ag-chat-thread-main">
                <span className="ag-chat-thread-name">{displayName(`${c.firstName} ${c.lastName}`)}</span>
                <span className="ag-chat-thread-last">{c.customerId} · {c.phone}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </BottomSheet>
  )
}
