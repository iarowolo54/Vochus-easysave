'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'

type Msg = {
  id: string; sender: string; senderName: string | null; message: string; imageUrl?: string | null; createdAt: string; read: boolean
}

export default function CustomerChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const res = await fetch('/api/customer/chat')
    if (res.status === 401) { router.push('/customer/login'); return }
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    try {
      await fetch('/api/customer/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), imageUrl: imgPreview }),
      })
      setText('')
      setImgPreview(null)
      await load()
    } finally { setSending(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{
        height: 56, background: 'linear-gradient(135deg,#071a0e,#0e4d24)', flexShrink: 0,
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,.3)', zIndex: 10,
      }}>
        <button onClick={() => router.push('/customer/dashboard')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Support Chat</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Messages with your agent & admin</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
        {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 20 }}>Loading…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>No messages yet</div>
            <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 4 }}>Send a message to your agent or support team.</div>
          </div>
        )}
        {messages.map(msg => {
          const isCustomer = msg.sender === 'customer'
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isCustomer ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <div style={{ maxWidth: '78%' }}>
                {!isCustomer && <div style={{ fontSize: 10.5, color: 'var(--mu)', marginBottom: 3, fontWeight: 600 }}>{msg.senderName ?? msg.sender}</div>}
                <div style={{
                  borderRadius: isCustomer ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: isCustomer ? 'var(--g)' : 'var(--card)',
                  border: isCustomer ? 'none' : '1px solid var(--br)',
                  overflow: 'hidden',
                }}>
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="shared" style={{ width: '100%', maxWidth: 260, display: 'block', borderRadius: msg.message ? '14px 14px 0 0' : undefined }} onClick={() => window.open(msg.imageUrl!, '_blank')} />
                  )}
                  {msg.message && (
                    <div style={{ padding: '10px 14px', color: isCustomer ? '#fff' : 'var(--txt)', fontSize: 14, lineHeight: 1.5 }}>
                      {msg.message}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 3, textAlign: isCustomer ? 'right' : 'left' }}>
                  {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Image preview */}
      {imgPreview && (
        <div style={{ padding: '8px 16px', background: 'var(--card)', borderTop: '1px solid var(--br)' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={imgPreview} alt="preview" style={{ height: 72, borderRadius: 10, border: '2px solid var(--g)' }} />
            <button onClick={() => setImgPreview(null)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#e74c3c', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✕</button>
          </div>
        </div>
      )}

      <div style={{
        padding: '10px 16px', background: 'var(--card)', borderTop: '1px solid var(--br)',
        display: 'flex', gap: 8, alignItems: 'flex-end',
        paddingBottom: `calc(10px + env(safe-area-inset-bottom,0px))`,
      }}>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg)', border: '1.5px solid var(--br)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🖼️</button>
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Type a message…"
          rows={1}
          style={{
            flex: 1, border: '1.5px solid var(--br)', borderRadius: 20, padding: '10px 14px',
            fontSize: 14, fontFamily: 'Inter', resize: 'none', outline: 'none',
            marginBottom: 0, maxHeight: 100, overflowY: 'auto',
          }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button
          onClick={send} disabled={(!text.trim() && !imgPreview) || sending}
          style={{
            width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
            background: (text.trim() || imgPreview) ? 'var(--g)' : 'var(--br)',
            border: 'none', cursor: (text.trim() || imgPreview) ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}
        >{sending ? '⏳' : '➤'}</button>
      </div>

      <BottomNav items={[
        { key: 'home',     icon: '🏠', label: 'Home',     href: '/customer/dashboard' },
        { key: 'save',     icon: '💳', label: 'Save',     href: '/customer/save' },
        { key: 'history',  icon: '📊', label: 'History',  href: '/customer/transactions' },
        { key: 'chat',     icon: '💬', label: 'Chat',     href: '/customer/chat' },
        { key: 'settings', icon: '⚙️', label: 'Settings', href: '/customer/settings' },
      ]} />
    </div>
  )
}
