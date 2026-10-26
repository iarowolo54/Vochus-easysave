'use client'
import { useEffect, useRef, useState } from 'react'

type Customer = {
  id: string; customerId: string; firstName: string; lastName: string
  photoUrl: string | null; unread: number; lastMessage: string | null; lastAt: string | null
}

type Msg = {
  id: string; sender: string; senderName: string | null; message: string; imageUrl?: string | null; createdAt: string
}

export default function AgentChatPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const styles = `
    @media (max-width: 767px) {
      .chat-sidebar { width: ${selected ? 0 : '100%'} !important; display: ${selected ? 'none' : 'flex'} !important; }
      .back-btn-mobile { display: flex !important; }
    }
  `

  async function loadList() {
    const res = await fetch('/api/agent/customer-chat')
    const data = await res.json()
    if (data.customers) setCustomers(data.customers)
  }

  async function loadMessages(customerId: string) {
    const res = await fetch(`/api/agent/customer-chat?customerId=${customerId}`)
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
  }

  useEffect(() => {
    loadList()
    const iv = setInterval(() => {
      loadList()
      if (selectedRef.current) loadMessages(selectedRef.current)
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function selectCustomer(c: Customer) {
    setSelected(c)
    selectedRef.current = c.id
    setMessages([])
    loadMessages(c.id)
    setCustomers(prev => prev.map(p => p.id === c.id ? { ...p, unread: 0 } : p))
  }

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
    if ((!text.trim() && !imgPreview) || sending || !selected) return
    setSending(true)
    try {
      await fetch('/api/agent/customer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selected.id, message: text.trim(), imageUrl: imgPreview }),
      })
      setText('')
      setImgPreview(null)
      await loadMessages(selected.id)
    } finally { setSending(false) }
  }

  const initials = (c: Customer) => `${c.firstName[0]}${c.lastName[0]}`
  const totalUnread = customers.reduce((s, c) => s + c.unread, 0)

  return (
    <>
      <style>{styles}</style>
      <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: 'var(--bg)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--br)' }}>
        {/* Left: customer list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--br)', display: 'flex', flexDirection: 'column', background: 'var(--card)' }} className="chat-sidebar">
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💬</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Customer Messages</span>
          {totalUnread > 0 && (
            <span style={{ marginLeft: 'auto', background: 'var(--g)', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 7px' }}>
              {totalUnread}
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {customers.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--mu)', fontSize: 13 }}>
              No messages yet
            </div>
          )}
          {customers.map(c => (
            <div
              key={c.id}
              onClick={() => selectCustomer(c)}
              style={{
                padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--br)',
                background: selected?.id === c.id ? 'var(--gl)' : 'transparent',
                display: 'flex', gap: 10, alignItems: 'center',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%', background: 'var(--g)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0,
              }}>
                {initials(c)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{c.firstName} {c.lastName}</span>
                  {c.unread > 0 && (
                    <span style={{ background: 'var(--g)', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', flexShrink: 0 }}>
                      {c.unread}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.lastMessage ?? '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: conversation */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--mu)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Select a customer to view messages</div>
          </div>
        ) : (
          <>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--br)', background: 'var(--card)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--g)', cursor: 'pointer', fontSize: 18, padding: 0, display: 'none', flexShrink: 0 }} className="back-btn-mobile">←</button>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: 'var(--g)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0,
              }}>
                {initials(selected)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.firstName} {selected.lastName}</div>
                <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{selected.customerId}</div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 20 }}>No messages yet</div>
              )}
              {messages.map(msg => {
                const isAgent = msg.sender === 'agent'
                return (
                  <div key={msg.id} style={{ display: 'flex', justifyContent: isAgent ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '75%' }}>
                      {!isAgent && <div style={{ fontSize: 10.5, color: 'var(--mu)', marginBottom: 3, fontWeight: 600 }}>{msg.senderName ?? 'Customer'}</div>}
                      <div style={{
                        borderRadius: isAgent ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        background: isAgent ? 'var(--g)' : 'var(--card)',
                        border: isAgent ? 'none' : '1px solid var(--br)',
                        overflow: 'hidden',
                      }}>
                        {msg.imageUrl && (
                          <img src={msg.imageUrl} alt="shared" style={{ width: '100%', maxWidth: 260, display: 'block' }} onClick={() => window.open(msg.imageUrl!, '_blank')} />
                        )}
                        {msg.message && (
                          <div style={{ padding: '10px 14px', color: isAgent ? '#fff' : 'var(--txt)', fontSize: 14, lineHeight: 1.5 }}>
                            {msg.message}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 3, textAlign: isAgent ? 'right' : 'left' }}>
                        {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {imgPreview && (
              <div style={{ padding: '8px 16px', background: 'var(--card)', borderTop: '1px solid var(--br)' }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={imgPreview} alt="preview" style={{ height: 72, borderRadius: 10, border: '2px solid var(--g)' }} />
                  <button onClick={() => setImgPreview(null)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#e74c3c', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✕</button>
                </div>
              </div>
            )}
            <div style={{ padding: '10px 16px', background: 'var(--card)', borderTop: '1px solid var(--br)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg)', border: '1.5px solid var(--br)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🖼️</button>
              <textarea
                value={text} onChange={e => setText(e.target.value)}
                placeholder={`Reply to ${selected.firstName}…`}
                rows={1}
                style={{
                  flex: 1, border: '1.5px solid var(--br)', borderRadius: 20, padding: '10px 14px',
                  fontSize: 14, fontFamily: 'Inter', resize: 'none', outline: 'none',
                  maxHeight: 100, overflowY: 'auto',
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
          </>
        )}
      </div>
    </div>
    </>
  )
}
