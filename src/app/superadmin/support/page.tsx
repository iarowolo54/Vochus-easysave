'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icons } from '@/components/ui/icons'
import { isChatImage } from '@/lib/chat-image'
import { resizeImage } from '@/lib/resize-image'
import { MESSAGE_MAX, SUPPORT_UNREAD_EVENT } from '@/lib/support-limits'
import {
  Avatar, Empty, LoadError, Modal, PageHeader, Pager, SearchField, Segmented, useDebounced, useToast,
} from '../_components/admin-ui'

type PartyType = 'agent' | 'customer'
type ListParty = { type: PartyType; id: string; code: string; name: string; status: string; photoUrl?: string | null }
type ThreadRow = { id: string; status: string; lastMessageAt: string; unread: number; preview: string | null; lastFromOffice: boolean; party: ListParty | null }
type Party = ListParty & { phone?: string; customerType?: string; agentName?: string | null; agentCode?: string | null }
type Msg = { id: string; sender: string; senderName: string | null; message: string; imageUrl: string | null; readByParty: boolean; createdAt: string }
type Person = { type: PartyType; id: string; code: string; name: string; status: string; threadId: string | null; photoUrl?: string | null }
/** The right-hand pane: an existing conversation, or a first message to someone with none yet. */
type Selected = { kind: 'thread'; id: string } | { kind: 'draft'; person: Person } | null

type TypeTab = 'all' | 'agent' | 'customer'
type StatusTab = 'Open' | 'unread' | 'Closed' | 'all'
const PAGE_SIZE = 30

const typeLabel = (t: PartyType) => (t === 'agent' ? 'Agent' : 'Customer')

function when(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  const y = new Date(); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function SupportInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [toastNode, toast] = useToast()

  // ── Inbox ──
  const [typeTab, setTypeTab] = useState<TypeTab>('all')
  const [statusTab, setStatusTab] = useState<StatusTab>('Open')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(1)
  const [threads, setThreads] = useState<ThreadRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [listFailed, setListFailed] = useState(false)
  const listLoaded = useRef(false)

  const [selected, setSelected] = useState<Selected>(null)
  const [newOpen, setNewOpen] = useState(false)

  const loadList = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (typeTab !== 'all') sp.set('type', typeTab)
    if (statusTab === 'Open' || statusTab === 'Closed') sp.set('status', statusTab)
    if (statusTab === 'unread') sp.set('unread', '1')
    if (dq.trim()) sp.set('q', dq.trim())
    try {
      const res = await fetch(`/api/admin/support?${sp}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { threads: ThreadRow[]; total: number }
      setThreads(d.threads); setTotal(d.total); setListFailed(false)
      listLoaded.current = true
    } catch {
      // Keep showing the last list on a failed poll; only an empty screen becomes an error.
      if (!listLoaded.current) setListFailed(true)
    }
  }, [page, typeTab, statusTab, dq])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible') loadList() }, 10_000)
    return () => clearInterval(iv)
  }, [loadList])
  useEffect(() => { setPage(1) }, [typeTab, statusTab, dq])

  // Message button on an agent's or customer's page: /superadmin/support?agent=<id> | ?customer=<id>
  const deepAgent = params.get('agent')
  const deepCustomer = params.get('customer')
  useEffect(() => {
    if (!deepAgent && !deepCustomer) return
    const key = deepAgent ? `agentId=${encodeURIComponent(deepAgent)}` : `customerId=${encodeURIComponent(deepCustomer as string)}`
    fetch(`/api/admin/support/people?${key}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) { toast(await errorOf(r, 'We couldn’t find that person'), 'error'); return }
        const { person } = await r.json() as { person: Person }
        setSelected(person.threadId ? { kind: 'thread', id: person.threadId } : { kind: 'draft', person })
      })
      .catch(() => toast('We couldn’t open that chat. Check your connection.', 'error'))
      .finally(() => router.replace('/superadmin/support'))
  }, [deepAgent, deepCustomer, router, toast])

  function pickPerson(p: Person) {
    setNewOpen(false)
    setSelected(p.threadId ? { kind: 'thread', id: p.threadId } : { kind: 'draft', person: p })
  }

  // A chat was opened, answered or closed: refresh the list and the sidebar count together.
  const onChanged = useCallback(() => {
    loadList()
    window.dispatchEvent(new Event(SUPPORT_UNREAD_EVENT))
  }, [loadList])

  const selectedId = selected?.kind === 'thread' ? selected.id : null
  const emptyText: Record<StatusTab, { title: string; text: string }> = {
    Open: { title: 'No open chats', text: 'When an agent or customer messages Vochus Support, it shows here.' },
    unread: { title: 'All caught up', text: 'No one is waiting for a reply.' },
    Closed: { title: 'No closed chats', text: 'Chats you close show here. A new message opens them again.' },
    all: { title: 'No chats yet', text: 'Start one with New message, or wait for an agent or customer to write.' },
  }

  return (
    <div className="sc-page">
      {toastNode}
      <PageHeader
        title="Support chat"
        sub="Private chats with agents and customers. They see every reply as Vochus Support."
        actions={<button type="button" className="btn btn-green" onClick={() => setNewOpen(true)}><Icons.add size={18} aria-hidden="true" /> New message</button>}
      />

      <div className={`sc-wrap${selected ? ' has-selection' : ''}`}>
        <section className="sc-inbox card" aria-label="Chats">
          <div className="sc-filters">
            <SearchField value={q} onChange={setQ} placeholder="Name, ID or phone" label="Search chats" />
            <Segmented label="Who" value={typeTab} onChange={setTypeTab} options={[
              { value: 'all', label: 'All' }, { value: 'agent', label: 'Agents' }, { value: 'customer', label: 'Customers' },
            ]} />
            <Segmented label="Status" value={statusTab} onChange={setStatusTab} options={[
              { value: 'Open', label: 'Open' }, { value: 'unread', label: 'Unread' }, { value: 'Closed', label: 'Closed' }, { value: 'all', label: 'All' },
            ]} />
          </div>

          {listFailed && <LoadError what="chats" onRetry={() => { setListFailed(false); loadList() }} />}
          {!listFailed && threads === null && (
            <ul className="sc-list" aria-busy="true" aria-label="Loading chats">
              {Array.from({ length: 6 }, (_, i) => <li key={i} className="sc-row"><span className="skel sc-skel-av" /><span className="skel sc-skel-line" /></li>)}
            </ul>
          )}
          {!listFailed && threads?.length === 0 && (
            <Empty icon="chat" title={dq ? 'No chats match your search' : emptyText[statusTab].title} text={dq ? 'Try a different name, ID or phone.' : emptyText[statusTab].text} />
          )}
          {!listFailed && threads && threads.length > 0 && (
            <ul className="sc-list">
              {threads.map(t => {
                const name = t.party?.name ?? 'Deleted account'
                return (
                  <li key={t.id}>
                    <button type="button" className={`sc-row${selectedId === t.id ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}`}
                      aria-current={selectedId === t.id ? 'true' : undefined}
                      onClick={() => setSelected({ kind: 'thread', id: t.id })}>
                      <Avatar name={name} photoUrl={t.party?.photoUrl} tone={t.party?.type === 'agent' ? 'blue' : 'green'} />
                      <span className="sc-row-main">
                        <span className="sc-row-top">
                          <span className="sc-row-name">{name}</span>
                          <span className="sc-row-time">{when(t.lastMessageAt)}</span>
                        </span>
                        <span className="sc-row-sub">
                          {t.party ? `${typeLabel(t.party.type)} · ${t.party.code}` : 'No longer exists'}
                          {t.status === 'Closed' && <span className="bdg bdg-grey">Closed</span>}
                        </span>
                        <span className="sc-row-bottom">
                          <span className="sc-row-preview">{t.lastFromOffice ? 'You: ' : ''}{t.preview ?? ''}</span>
                          {t.unread > 0 && <span className="sc-unread" aria-label={`${t.unread} unread`}>{t.unread > 9 ? '9+' : t.unread}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </section>

        <section className="sc-pane card" aria-label="Conversation">
          {selected === null && (
            <Empty icon="chat" title="Choose a chat" text="Pick a conversation on the left, or start one with New message." />
          )}
          {selected?.kind === 'thread' && (
            <ThreadPane key={selected.id} threadId={selected.id} onBack={() => setSelected(null)} onChanged={onChanged} toast={toast} />
          )}
          {selected?.kind === 'draft' && (
            <DraftPane key={selected.person.id} person={selected.person} onBack={() => setSelected(null)}
              onStarted={id => { setSelected({ kind: 'thread', id }); onChanged() }} />
          )}
        </section>
      </div>

      {newOpen && <NewMessageModal onClose={() => setNewOpen(false)} onPick={pickPerson} />}
    </div>
  )
}

/** Composer shared by a conversation and a first message. Keeps the text and picture when a send fails. */
function Composer({ onSend, placeholder }: { onSend: (body: { message: string; imageUrl: string | null }) => Promise<string | null>; placeholder: string }) {
  const [text, setText] = useState('')
  const [img, setImg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const data = await resizeImage(file)
    if (data) setImg(data); else setError('That file isn’t a picture we can send.')
  }

  async function send() {
    if ((!text.trim() && !img) || sending) return
    setSending(true); setError('')
    const err = await onSend({ message: text.trim(), imageUrl: img })
    setSending(false)
    if (err) { setError(`Message not sent. ${err}`); return }
    setText(''); setImg(null)
    inputRef.current?.focus()
  }

  const over = text.length > MESSAGE_MAX
  return (
    <div className="sc-composer">
      {error && <p className="sc-composer-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
      {img && (
        <div className="sc-composer-preview">
          <img src={img} alt="Picture to send" />
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setImg(null)} aria-label="Remove picture"><Icons.close size={16} aria-hidden="true" /></button>
        </div>
      )}
      <div className="sc-composer-row">
        <input ref={fileRef} type="file" accept="image/*" onChange={pick} hidden />
        <button type="button" className="sc-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Add a picture"><Icons.image size={20} aria-hidden="true" /></button>
        <label htmlFor="sc-input" className="sr-only">Message</label>
        <textarea id="sc-input" ref={inputRef} rows={1} value={text} placeholder={placeholder}
          onChange={e => { setText(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
        <button type="button" className="sc-send" onClick={send} disabled={(!text.trim() && !img) || sending || over} aria-label={sending ? 'Sending' : 'Send'} aria-busy={sending}>
          {sending ? <span className="sc-spinner" aria-hidden="true" /> : <Icons.send size={20} aria-hidden="true" />}
        </button>
      </div>
      {over && <p className="sc-composer-hint">{(text.length - MESSAGE_MAX).toLocaleString('en-GB')} characters over the limit</p>}
    </div>
  )
}

function Bubbles({ messages, partyName }: { messages: Msg[]; partyName: string }) {
  return (
    <>
      {messages.map((m, i) => {
        const mine = m.sender === 'admin'
        const showDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(m.createdAt)
        return (
          <div key={m.id}>
            {showDay && <p className="sc-day">{dayLabel(m.createdAt)}</p>}
            <div className={`sc-bubble-row${mine ? ' is-mine' : ''}`}>
              <div className={`sc-bubble${mine ? ' is-mine' : ''}`}>
                {isChatImage(m.imageUrl) && (
                  <a href={m.imageUrl} target="_blank" rel="noreferrer" className="sc-bubble-img">
                    <img src={m.imageUrl} alt={mine ? 'Picture sent by Vochus Support' : `Picture from ${partyName}`} />
                  </a>
                )}
                {m.message && <p className="sc-bubble-text">{m.message}</p>}
                <span className="sc-bubble-meta">
                  {mine && m.senderName ? `${m.senderName} · ` : ''}
                  {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  {mine && (m.readByParty ? ' · Seen' : '')}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

function ThreadPane({ threadId, onBack, onChanged, toast }: {
  threadId: string; onBack: () => void; onChanged: () => void; toast: (msg: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const [party, setParty] = useState<Party | null>(null)
  const [status, setStatus] = useState('Open')
  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastCount = useRef(0)
  const loaded = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/support/${threadId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { thread: { status: string; party: Party | null }; messages: Msg[] }
      setParty(d.thread.party); setStatus(d.thread.status); setMessages(d.messages); setFailed(false)
      if (!loaded.current) { loaded.current = true; onChanged() } // opening it cleared the unread count
    } catch {
      if (!loaded.current) setFailed(true)
    }
  }, [threadId, onChanged])

  useEffect(() => {
    load()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5000)
    return () => clearInterval(iv)
  }, [load])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return
    if (messages.length !== lastCount.current && stick.current) el.scrollTop = el.scrollHeight
    lastCount.current = messages.length
  }, [messages])

  async function send(body: { message: string; imageUrl: string | null }) {
    try {
      const res = await fetch(`/api/admin/support/${threadId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) return await errorOf(res, 'Please try again.')
      stick.current = true
      await load(); onChanged()
      return null
    } catch {
      return 'Check your connection and try again.'
    }
  }

  async function toggleStatus() {
    const next = status === 'Closed' ? 'Open' : 'Closed'
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/support/${threadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
      if (!res.ok) { toast(await errorOf(res, 'We couldn’t change this chat'), 'error'); return }
      setStatus(next); onChanged()
      toast(next === 'Closed' ? 'Chat closed' : 'Chat reopened', 'success')
    } catch {
      toast('We couldn’t change this chat. Check your connection.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <LoadError what="this chat" onRetry={() => { setFailed(false); load() }} />
  const name = party?.name ?? 'Deleted account'

  return (
    <div className="sc-thread">
      <header className="sc-thread-hd">
        <button type="button" className="sc-icon-btn sc-back" onClick={onBack} aria-label="Back to chats"><Icons.back size={20} aria-hidden="true" /></button>
        <Avatar name={name} photoUrl={party?.photoUrl} tone={party?.type === 'agent' ? 'blue' : 'green'} />
        <div className="sc-thread-who">
          <h2>{messages === null ? <span className="skel sc-skel-line" /> : name}</h2>
          {party && (
            <p>
              {typeLabel(party.type)} · {party.code}
              {party.type === 'customer' && party.customerType && ` · ${party.customerType === 'online' ? 'Online' : 'Offline'}`}
              {party.type === 'customer' && party.agentName && ` · Agent ${party.agentName}`}
              {party.status !== 'Active' && <> · <span className="bdg bdg-a">{party.status}</span></>}
            </p>
          )}
        </div>
        <div className="sc-thread-actions">
          {party?.phone && <a className="sc-icon-btn" href={`tel:${party.phone}`} aria-label={`Call ${name}`}><Icons.phone size={18} aria-hidden="true" /></a>}
          {party?.type === 'agent' && <Link className="btn btn-outline btn-sm" href={`/superadmin/agents/${party.id}`}>Profile</Link>}
          {messages !== null && (
            <button type="button" className="btn btn-outline btn-sm" onClick={toggleStatus} disabled={busy}>
              {busy ? 'Saving…' : status === 'Closed' ? 'Reopen' : 'Close chat'}
            </button>
          )}
        </div>
      </header>

      <div className="sc-messages" ref={listRef} aria-live="polite"
        onScroll={() => { const el = listRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {messages === null && (
          <div aria-busy="true" aria-label="Loading messages">
            <div className="sc-bubble-row"><span className="skel" style={{ width: '55%', height: 44 }} /></div>
            <div className="sc-bubble-row is-mine"><span className="skel" style={{ width: '45%', height: 44 }} /></div>
          </div>
        )}
        {messages?.length === 0 && <Empty icon="chat" title="No messages yet" />}
        {messages && <Bubbles messages={messages} partyName={name} />}
      </div>

      {status === 'Closed' && <p className="sc-closed-note">This chat is closed. Sending a message opens it again.</p>}
      {party ? <Composer onSend={send} placeholder={`Message ${name.split(' ')[0]} as Vochus Support…`} />
        : messages !== null && <p className="sc-closed-note">This account no longer exists, so you can’t reply.</p>}
    </div>
  )
}

function DraftPane({ person, onBack, onStarted }: { person: Person; onBack: () => void; onStarted: (threadId: string) => void }) {
  async function send(body: { message: string; imageUrl: string | null }) {
    try {
      const res = await fetch('/api/admin/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(person.type === 'agent' ? { agentId: person.id } : { customerId: person.id }) }),
      })
      if (!res.ok) return await errorOf(res, 'Please try again.')
      const d = await res.json() as { threadId: string }
      onStarted(d.threadId)
      return null
    } catch {
      return 'Check your connection and try again.'
    }
  }
  return (
    <div className="sc-thread">
      <header className="sc-thread-hd">
        <button type="button" className="sc-icon-btn sc-back" onClick={onBack} aria-label="Back to chats"><Icons.back size={20} aria-hidden="true" /></button>
        <Avatar name={person.name} photoUrl={person.photoUrl} tone={person.type === 'agent' ? 'blue' : 'green'} />
        <div className="sc-thread-who">
          <h2>{person.name}</h2>
          <p>{typeLabel(person.type)} · {person.code}{person.status !== 'Active' && <> · <span className="bdg bdg-a">{person.status}</span></>}</p>
        </div>
      </header>
      <div className="sc-messages">
        <Empty icon="chat" title={`Start a chat with ${person.name.split(' ')[0]}`}
          text={`They’ll see it from Vochus Support in their app${person.type === 'agent' ? '' : ', and their agent won’t'}.`} />
      </div>
      <Composer onSend={send} placeholder={`Message ${person.name.split(' ')[0]} as Vochus Support…`} />
    </div>
  )
}

function NewMessageModal({ onClose, onPick }: { onClose: () => void; onPick: (p: Person) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (dq.trim().length < 2) { setPeople(null); setError(''); return }
    const ctrl = new AbortController()
    fetch(`/api/admin/support/people?q=${encodeURIComponent(dq.trim())}`, { signal: ctrl.signal, cache: 'no-store' })
      .then(async r => {
        if (!r.ok) { setError(await errorOf(r, 'We couldn’t search right now.')); setPeople([]); return }
        const d = await r.json() as { people: Person[] }
        setPeople(d.people); setError('')
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') { setError('We couldn’t search. Check your connection.'); setPeople([]) } })
    return () => ctrl.abort()
  }, [dq])

  return (
    <Modal title="New message" sub="Find an agent or customer by name, ID or phone." onClose={onClose} error={error || undefined}>
      <SearchField value={q} onChange={setQ} placeholder="Name, ID or phone" label="Search agents and customers" />
      <div className="sc-people" aria-live="polite">
        {dq.trim().length < 2 && <p className="sc-people-hint">Type at least 2 letters.</p>}
        {people?.length === 0 && !error && <p className="sc-people-hint">No one matches “{dq.trim()}”.</p>}
        {people && people.length > 0 && (
          <ul className="sc-list">
            {people.map(p => (
              <li key={`${p.type}:${p.id}`}>
                <button type="button" className="sc-row" onClick={() => onPick(p)}>
                  <Avatar name={p.name} photoUrl={p.photoUrl} tone={p.type === 'agent' ? 'blue' : 'green'} />
                  <span className="sc-row-main">
                    <span className="sc-row-name">{p.name}</span>
                    <span className="sc-row-sub">
                      {typeLabel(p.type)} · {p.code}
                      {p.status !== 'Active' && <span className="bdg bdg-a">{p.status}</span>}
                      {p.threadId && <span className="bdg bdg-grey">Has a chat</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default function SupportChatPage() {
  return (
    <Suspense fallback={null}>
      <SupportInner />
    </Suspense>
  )
}
