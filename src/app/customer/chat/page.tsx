'use client'
import { isChatImage } from '@/lib/chat-image'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import EmptyState from '@/components/ui/EmptyState'
import LogoLoader from '@/components/ui/LogoLoader'
import { Bone } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { displayName, formatTime } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'
import SupportChatScreen from '@/components/SupportChatScreen'

type Msg = {
  id: string; sender: string; senderName: string | null; message: string; imageUrl?: string | null; createdAt: string; read: boolean
}
type Me = { agent: { name: string; agentId: string; phone: string } }

const PROMPTS = [
  'A deposit isn’t showing in my savings',
  'How do I redeem my money?',
  'I want to change my daily amount',
]

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Switch between the chat with the customer's agent and the private chat with Vochus Support, each with its unread count. */
function ChatTabs({ active }: { active: 'agent' | 'vochus' }) {
  const router = useRouter()
  const [unread, setUnread] = useState<{ agent: number; support: number }>({ agent: 0, support: 0 })
  useEffect(() => {
    let stopped = false
    const load = () => fetch('/api/customer/chat/unread', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { agent?: unknown; support?: unknown } | null) => {
        if (stopped || !d) return
        setUnread({ agent: typeof d.agent === 'number' ? d.agent : 0, support: typeof d.support === 'number' ? d.support : 0 })
      })
      .catch(() => {})
    load()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15_000)
    return () => { stopped = true; clearInterval(iv) }
  }, [active])
  const tab = (key: 'agent' | 'vochus', label: string, count: number) => (
    <button type="button" aria-pressed={active === key} onClick={() => { if (active !== key) router.replace(key === 'vochus' ? '/customer/chat?with=vochus' : '/customer/chat') }}>
      {label}{active !== key && count > 0 && <span className="ui-chat-tab-count" aria-label={`${count} unread`}>{count > 9 ? '9+' : count}</span>}
    </button>
  )
  return (
    <div className="ui-chat-tabs">
      <div className="ui-segment" role="group" aria-label="Who to message">
        {tab('agent', 'Your agent', unread.agent)}
        {tab('vochus', 'Vochus Support', unread.support)}
      </div>
    </div>
  )
}

function ChatSwitch() {
  const router = useRouter()
  const params = useSearchParams()
  const onBack = useCallback(() => router.push('/customer/dashboard'), [router])
  const onUnauthorized = useCallback(() => router.push('/customer/login'), [router])
  if (params.get('with') === 'vochus') {
    return (
      <SupportChatScreen who="customer" endpoint="/api/customer/support" onBack={onBack} onUnauthorized={onUnauthorized}
        tabs={<ChatTabs active="vochus" />}
        emptyText="Only Vochus staff can read this chat. Your agent can’t see it." />
    )
  }
  return <ChatInner />
}

function ChatInner() {
  const router = useRouter()
  const params = useSearchParams()
  const aboutRef = params.get('ref')
  const me = useCustomerMe<Me>()

  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [text, setText] = useState(aboutRef ? `Hi, I have a question about transaction ${aboutRef}.` : '')
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const lastCount = useRef(0)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/customer/chat')
      if (res.status === 401) { router.push('/customer/login'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMessages(data.messages ?? [])
      setLoadFailed(false)
      loadedOnce.current = true
    } catch {
      // Keep showing what we have; only show the error screen if nothing ever loaded.
      if (!loadedOnce.current) setLoadFailed(true)
    }
  }, [router])

  useEffect(() => {
    load()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5000)
    return () => clearInterval(iv)
  }, [load])

  // Only jump to the newest message when one arrives and the reader is already near the bottom,
  // so polling never yanks someone away from older messages they're reading.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return
    if (messages.length !== lastCount.current && stickToBottom.current) el.scrollTop = el.scrollHeight
    lastCount.current = messages.length
  }, [messages])

  function onScroll() {
    const el = listRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Grow the box with the text, up to about five lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 900
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      setImgPreview(canvas.toDataURL('image/jpeg', 0.75))
      URL.revokeObjectURL(url)
    }
    img.src = url
    e.target.value = ''
  }

  async function send() {
    if ((!text.trim() && !imgPreview) || sending) return
    setSending(true)
    setSendError('')
    const result = await postJson('/api/customer/chat', { message: text.trim(), imageUrl: imgPreview })
    setSending(false)
    if (!result.ok) {
      // Keep the text and photo so nothing the customer typed is lost.
      setSendError(`Message not sent. ${describeFailure(result)}`)
      return
    }
    setText('')
    setImgPreview(null)
    stickToBottom.current = true
    // Sent: drop ?ref= so a reload doesn't pre-fill the same question again.
    if (aboutRef) router.replace('/customer/chat')
    await load()
  }

  const agentName = me.data ? displayName(me.data.agent.name) : 'Your agent'
  const firstName = agentName.split(' ')[0]

  return (
    <div className="ui-screen ui-chat">
      <header className="ui-topbar ui-chat-head">
        <button type="button" className="ui-icon-btn" onClick={() => router.push('/customer/dashboard')} aria-label="Back to home">
          <Icons.back size={22} aria-hidden="true" />
        </button>
        <span className="ui-avatar" aria-hidden="true">{agentName[0]}</span>
        <div className="ui-topbar-main">
          <h1 className="ui-topbar-title">{agentName}</h1>
          <div className="ui-topbar-sub">Your agent{me.data ? ` · ${me.data.agent.agentId}` : ''}</div>
        </div>
        {me.data && (
          <a className="ui-icon-btn" href={`tel:${me.data.agent.phone}`} aria-label={`Call ${firstName}`}>
            <Icons.phone size={20} aria-hidden="true" />
          </a>
        )}
      </header>
      <ChatTabs active="agent" />

      <div className="ui-chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {messages === null && !loadFailed && (
          <div className="ui-skeleton" role="status" aria-label="Loading messages">
            <div className="ui-bubble-row"><Bone w="62%" h={44} /></div>
            <div className="ui-bubble-row ui-bubble-row--mine"><Bone w="48%" h={44} /></div>
            <div className="ui-bubble-row"><Bone w="55%" h={60} /></div>
          </div>
        )}

        {loadFailed && (
          <EmptyState
            icon="error"
            tone="danger"
            title="We couldn't load your messages"
            text="Check your connection and try again."
            action={<button type="button" className="ui-btn ui-btn--primary" onClick={() => { setLoadFailed(false); load() }}><Icons.retry size={18} aria-hidden="true" /> Try again</button>}
          />
        )}

        {messages && messages.length === 0 && (
          <div className="ui-chat-empty">
            <EmptyState icon="chat" title={`Message ${firstName}`} text="Ask about a deposit, redeeming your money or your plan." />
            <div className="ui-chat-prompts">
              {PROMPTS.map(p => (
                <button key={p} type="button" className="ui-chip" onClick={() => { setText(p); inputRef.current?.focus() }}>{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages?.map((msg, i) => {
          const mine = msg.sender === 'customer'
          const showDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(msg.createdAt)
          return (
            <div key={msg.id}>
              {showDay && <p className="ui-chat-day">{dayLabel(msg.createdAt)}</p>}
              <div className={`ui-bubble-row${mine ? ' ui-bubble-row--mine' : ''}`}>
                <div className={`ui-bubble${mine ? ' ui-bubble--mine' : ''}`}>
                  {isChatImage(msg.imageUrl) && (
                    <a href={msg.imageUrl} target="_blank" rel="noreferrer" className="ui-bubble-img">
                      <img src={msg.imageUrl} alt={mine ? 'Photo you sent' : `Photo from ${firstName}`} />
                    </a>
                  )}
                  {msg.message && <p className="ui-bubble-text">{msg.message}</p>}
                  <span className="ui-bubble-time">{formatTime(msg.createdAt)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="ui-composer">
        {sendError && (
          <p className="ui-composer-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {sendError}</p>
        )}
        {imgPreview && (
          <div className="ui-composer-preview">
            <img src={imgPreview} alt="Photo to send" />
            <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => setImgPreview(null)} aria-label="Remove photo">
              <Icons.close size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="ui-composer-row">
          <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} hidden />
          <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => fileRef.current?.click()} aria-label="Add a photo">
            <Icons.image size={20} aria-hidden="true" />
          </button>
          <label htmlFor="chat-input" className="ui-sr-only">Message {firstName}</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            className="ui-composer-input"
            value={text}
            onChange={e => { setText(e.target.value); setSendError('') }}
            placeholder={`Message ${firstName}…`}
            rows={1}
          />
          <button
            type="button"
            className="ui-send"
            onClick={send}
            disabled={(!text.trim() && !imgPreview) || sending}
            aria-label={sending ? 'Sending' : 'Send message'}
            aria-busy={sending}
          >
            {sending ? <span className="ui-spinner ui-spinner--sm" /> : <Icons.send size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CustomerChatPage() {
  return (
    <Suspense fallback={<div className="ui-screen ui-screen--center"><LogoLoader delayed /></div>}>
      <ChatSwitch />
    </Suspense>
  )
}
