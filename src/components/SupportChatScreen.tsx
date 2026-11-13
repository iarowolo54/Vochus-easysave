'use client'
// The agent's and the customer's private chat with Vochus Support: a full-screen conversation (like the customer's
// chat with their agent), with the composer pinned above the keyboard. The server finds the thread from the session.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import EmptyState from '@/components/ui/EmptyState'
import { Bone } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { isChatImage } from '@/lib/chat-image'
import { formatTime } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'
import { resizeImage } from '@/lib/resize-image'
import { MESSAGE_MAX, SUPPORT_NAME } from '@/lib/support-limits'

type Msg = { id: string; sender: string; senderName: string; message: string; imageUrl: string | null; read: boolean; createdAt: string }

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SupportChatScreen({ who, endpoint, onBack, onUnauthorized, tabs, emptyText }: {
  /** Whose messages are "mine". */
  who: 'agent' | 'customer'
  endpoint: string
  onBack: () => void
  onUnauthorized: () => void
  /** Optional strip under the header (the customer's "Your agent | Vochus" switch). */
  tabs?: ReactNode
  emptyText: string
}) {
  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [text, setText] = useState('')
  const [img, setImg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const lastCount = useRef(0)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (res.status === 401) { onUnauthorized(); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { messages?: Msg[] }
      setMessages(data.messages ?? [])
      setLoadFailed(false)
      loadedOnce.current = true
    } catch {
      // Keep showing what we have; only an empty screen becomes an error.
      if (!loadedOnce.current) setLoadFailed(true)
    }
  }, [endpoint, onUnauthorized])

  useEffect(() => {
    load()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5000)
    return () => clearInterval(iv)
  }, [load])

  // Jump to the newest message only when the reader is already near the bottom.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return
    if (messages.length !== lastCount.current && stick.current) el.scrollTop = el.scrollHeight
    lastCount.current = messages.length
  }, [messages])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const data = await resizeImage(file)
    if (data) { setImg(data); setSendError('') } else setSendError('That file isn’t a photo we can send.')
  }

  async function send() {
    if ((!text.trim() && !img) || sending || text.length > MESSAGE_MAX) return
    setSending(true); setSendError('')
    const result = await postJson(endpoint, { message: text.trim(), imageUrl: img })
    setSending(false)
    if (!result.ok) {
      // Keep the text and photo so nothing typed is lost.
      setSendError(`Message not sent. ${describeFailure(result)}`)
      return
    }
    setText(''); setImg(null)
    stick.current = true
    await load()
  }

  const mineSender = who
  const over = text.length > MESSAGE_MAX

  return (
    <div className="ui-screen ui-chat">
      <header className="ui-topbar ui-chat-head">
        <button type="button" className="ui-icon-btn" onClick={onBack} aria-label="Back">
          <Icons.back size={22} aria-hidden="true" />
        </button>
        <span className="ui-avatar" aria-hidden="true">V</span>
        <div className="ui-topbar-main">
          <h1 className="ui-topbar-title">{SUPPORT_NAME}</h1>
          <div className="ui-topbar-sub">Vochus office</div>
        </div>
      </header>
      {tabs}

      <div className="ui-chat-list" ref={listRef} aria-live="polite"
        onScroll={() => { const el = listRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {messages === null && !loadFailed && (
          <div className="ui-skeleton" role="status" aria-label="Loading messages">
            <div className="ui-bubble-row"><Bone w="62%" h={44} /></div>
            <div className="ui-bubble-row ui-bubble-row--mine"><Bone w="48%" h={44} /></div>
          </div>
        )}

        {loadFailed && (
          <EmptyState icon="error" tone="danger" title="We couldn't load your messages" text="Check your connection and try again."
            action={<button type="button" className="ui-btn ui-btn--primary" onClick={() => { setLoadFailed(false); load() }}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
        )}

        {messages && messages.length === 0 && (
          <div className="ui-chat-empty">
            <EmptyState icon="support" title={`Message ${SUPPORT_NAME}`} text={emptyText} />
          </div>
        )}

        {messages?.map((m, i) => {
          const mine = m.sender === mineSender
          const showDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(m.createdAt)
          return (
            <div key={m.id}>
              {showDay && <p className="ui-chat-day">{dayLabel(m.createdAt)}</p>}
              <div className={`ui-bubble-row${mine ? ' ui-bubble-row--mine' : ''}`}>
                <div className={`ui-bubble${mine ? ' ui-bubble--mine' : ''}`}>
                  {isChatImage(m.imageUrl) && (
                    <a href={m.imageUrl} target="_blank" rel="noreferrer" className="ui-bubble-img">
                      <img src={m.imageUrl} alt={mine ? 'Photo you sent' : `Photo from ${SUPPORT_NAME}`} />
                    </a>
                  )}
                  {m.message && <p className="ui-bubble-text">{m.message}</p>}
                  <span className="ui-bubble-time">{formatTime(m.createdAt)}{mine && m.read ? ' · Seen' : ''}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="ui-composer">
        {sendError && <p className="ui-composer-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {sendError}</p>}
        {over && <p className="ui-composer-error" role="status">{(text.length - MESSAGE_MAX).toLocaleString('en-GB')} characters too long</p>}
        {img && (
          <div className="ui-composer-preview">
            <img src={img} alt="Photo to send" />
            <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setImg(null)} aria-label="Remove photo">
              <Icons.close size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="ui-composer-row">
          <input ref={fileRef} type="file" accept="image/*" onChange={pick} hidden />
          <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => fileRef.current?.click()} aria-label="Add a photo">
            <Icons.image size={20} aria-hidden="true" />
          </button>
          <label htmlFor="support-input" className="ui-sr-only">Message {SUPPORT_NAME}</label>
          <textarea id="support-input" ref={inputRef} className="ui-composer-input" value={text} rows={1}
            onChange={e => { setText(e.target.value); setSendError('') }} placeholder={`Message ${SUPPORT_NAME}…`} />
          <button type="button" className="ui-send" onClick={send} disabled={(!text.trim() && !img) || sending || over}
            aria-label={sending ? 'Sending' : 'Send message'} aria-busy={sending}>
            {sending ? <span className="ui-spinner ui-spinner--sm" /> : <Icons.send size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}
