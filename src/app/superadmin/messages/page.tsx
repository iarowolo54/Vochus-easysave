'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { AUDIENCES, AUDIENCE_LABEL, BODY_MAX, IMAGES_MAX, IMAGE_BYTES_MAX, TITLE_MAX, type Audience } from '@/lib/announcements'
import { ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, RowMenu, TableSkeleton, shortDate, useToast } from '../_components/admin-ui'

interface Message {
  id: string; title: string; body: string; audience: Audience; startsAt: string; endsAt: string
  isActive: boolean; createdBy: string | null; createdAt: string; seenBy: number; imageIds: string[]
}
type Form = { title: string; body: string; audience: Audience | ''; startDate: string; endDate: string; imageIds: string[] }
type Errors = Partial<Record<keyof Form, string>>

/** A stored instant as its Lagos calendar day (UTC+1, no daylight saving), for the date inputs. */
const lagosDay = (iso: string | Date) => new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 10)
const EMPTY: Form = { title: '', body: '', audience: '', startDate: '', endDate: '', imageIds: [] }

function statusOf(m: Message, now: number): { label: string; cls: string } {
  if (!m.isActive) return { label: 'Off', cls: 'bdg-grey' }
  if (new Date(m.endsAt).getTime() < now) return { label: 'Ended', cls: 'bdg-grey' }
  if (new Date(m.startsAt).getTime() > now) return { label: 'Scheduled', cls: 'bdg-b' }
  return { label: 'Showing now', cls: 'bdg-g' }
}

async function errorOf(res: Response, fallback: string): Promise<{ message: string; errors?: Errors }> {
  const d = await res.json().catch(() => ({})) as { error?: string; errors?: Errors }
  return { message: d.error ?? fallback, errors: d.errors }
}

export default function MessagesPage() {
  // Like the other admin pages, the buttons always show; the server refuses staff without Manage on this screen.
  const canManage = true
  const [items, setItems] = useState<Message[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [toastNode, toast] = useToast()

  const [editing, setEditing] = useState<Message | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState(0)
  const filePicker = useRef<HTMLInputElement>(null)

  const [action, setAction] = useState<{ kind: 'toggle' | 'delete'; item: Message } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/admin/announcements', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { announcements?: Message[] }
      setItems(d.announcements ?? [])
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => { load() }, [load])

  function openNew() {
    const today = lagosDay(new Date())
    setEditing(null); setForm({ ...EMPTY, startDate: today, endDate: today }); setErrors({}); setErr(''); setShowForm(true)
  }
  function openEdit(m: Message) {
    setEditing(m)
    setForm({ title: m.title, body: m.body, audience: m.audience, startDate: lagosDay(m.startsAt), endDate: lagosDay(m.endsAt), imageIds: m.imageIds })
    setErrors({}); setErr(''); setShowForm(true)
  }
  const setField = <K extends keyof Form>(k: K, v: Form[K]) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })) }

  /** Each picture uploads on its own, so one bad file doesn't lose the others. */
  async function addPictures(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (filePicker.current) filePicker.current.value = ''
    if (!files.length) return
    const room = IMAGES_MAX - form.imageIds.length
    const picked = files.slice(0, Math.max(room, 0))
    let problem = files.length > room ? `A message can have up to ${IMAGES_MAX} pictures.` : ''
    setUploading(picked.length)
    for (const file of picked) {
      try {
        if (file.size > IMAGE_BYTES_MAX) {
          problem = `${file.name} is over ${IMAGE_BYTES_MAX / (1024 * 1024)} MB.`
        } else {
          const body = new FormData()
          body.append('file', file)
          const res = await fetch('/api/admin/announcements/images', { method: 'POST', body })
          if (res.ok) {
            const { id } = await res.json() as { id: string }
            setForm(f => ({ ...f, imageIds: [...f.imageIds, id] }))
          } else {
            problem = (await errorOf(res, `${file.name} wasn’t added. Try again.`)).message
          }
        }
      } catch {
        problem = 'No connection. Check your internet and try again.'
      }
      setUploading(n => n - 1)
    }
    setErrors(e => ({ ...e, imageIds: problem || undefined, body: undefined }))
  }
  function movePicture(from: number, to: number) {
    setForm(f => {
      const next = [...f.imageIds]
      const [id] = next.splice(from, 1)
      next.splice(to, 0, id)
      return { ...f, imageIds: next }
    })
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      const res = await fetch(editing ? `/api/admin/announcements/${editing.id}` : '/api/admin/announcements', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      if (!res.ok) {
        const e = await errorOf(res, editing ? 'The message wasn’t saved. Try again.' : 'The message wasn’t created. Try again.')
        setErrors(e.errors ?? {}); setErr(e.message); return
      }
      toast(editing ? 'Message saved' : 'Message created', 'success')
      setShowForm(false)
      load()
    } catch {
      setErr('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function runAction() {
    if (!action) return
    const m = action.item
    setActionBusy(true); setActionError('')
    try {
      const res = action.kind === 'toggle'
        ? await fetch(`/api/admin/announcements/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !m.isActive }) })
        : await fetch(`/api/admin/announcements/${m.id}`, { method: 'DELETE' })
      if (!res.ok) { setActionError((await errorOf(res, 'That didn’t go through. Try again.')).message); return }
      toast(action.kind === 'delete' ? 'Message deleted' : m.isActive ? 'Message switched off' : 'Message switched on', 'success')
      setAction(null)
      load()
    } catch {
      setActionError('No connection. Check your internet and try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const now = Date.now()
  const newButton = canManage && <button type="button" className="btn btn-green" onClick={openNew}><Icons.add size={18} aria-hidden="true" /> New message</button>

  return (
    <>
      <PageHeader
        title="Pop-up messages"
        sub="Shown every time agents or customers sign in or open the app, until the end date."
        actions={newButton || undefined}
      />

      {failed && !loaded ? (
        <section className="card"><LoadError what="messages" onRetry={load} /></section>
      ) : (
        <section className="card" aria-labelledby="msg-h">
          <div className="card-hd"><h3 id="msg-h">Messages</h3></div>
          {!loaded ? <TableSkeleton rows={3} cols={5} />
            : items.length === 0 ? <Empty icon="bell" title="No messages yet" text="Create one to tell agents or customers something when they open the app." action={newButton || undefined} />
            : (
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>Message</th><th>Who sees it</th><th>Runs</th><th className="num">Closed by</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr>
                  </thead>
                  <tbody>
                    {items.map(m => {
                      const st = statusOf(m, now)
                      return (
                        <tr key={m.id}>
                          <td className="td-name">
                            {m.title}
                            {m.body && <div className="am-muted am-msg-preview">{m.body}</div>}
                            {m.imageIds.length > 0 && <div className="am-muted am-msg-preview">{m.imageIds.length === 1 ? '1 picture' : `${m.imageIds.length} pictures`}</div>}
                          </td>
                          <td data-label="Who sees it">{AUDIENCE_LABEL[m.audience] ?? m.audience}</td>
                          <td className="am-muted am-nowrap" data-label="Runs">{shortDate(m.startsAt)} to {shortDate(m.endsAt)}</td>
                          <td className="num" data-label="Closed by">{m.seenBy.toLocaleString('en-NG')}</td>
                          <td data-label="Status"><span className={`bdg ${st.cls}`}>{st.label}</span></td>
                          {canManage && (
                            <td>
                              <div className="a-row-actions">
                                <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(m)} aria-label={`Edit ${m.title}`}>Edit</button>
                                <RowMenu label={`More actions for ${m.title}`} items={[
                                  { label: m.isActive ? 'Switch off' : 'Switch on', onSelect: () => { setActionError(''); setAction({ kind: 'toggle', item: m }) } },
                                  { label: 'Delete message', danger: true, onSelect: () => { setActionError(''); setAction({ kind: 'delete', item: m }) } },
                                ]} />
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {showForm && (
        <Modal error={err || undefined} icon="bell" title={editing ? 'Edit message' : 'New message'}
          sub="Shows every time they sign in or open the app."
          onClose={() => setShowForm(false)} busy={saving}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={save} disabled={saving || uploading > 0}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create message'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); save() }} noValidate>
            <Field id="msg-title" label="Title" hint={`${form.title.length}/${TITLE_MAX}`} error={errors.title}>
              <input id="msg-title" className="a-input" value={form.title} maxLength={TITLE_MAX} aria-invalid={!!errors.title}
                onChange={e => setField('title', e.target.value)} placeholder="e.g. Office closed on Monday" />
            </Field>
            <Field id="msg-body" label="Message" hint={`${form.body.length}/${BODY_MAX}`} error={errors.body}>
              <textarea id="msg-body" className="a-input" rows={5} value={form.body} maxLength={BODY_MAX} aria-invalid={!!errors.body}
                onChange={e => setField('body', e.target.value)} />
            </Field>
            <Field id="msg-pics" label="Pictures" hint={`${form.imageIds.length}/${IMAGES_MAX}. JPG, PNG or WebP, up to ${IMAGE_BYTES_MAX / (1024 * 1024)} MB each. Two or more show as a slider.`} error={errors.imageIds}>
              <div>
                <input ref={filePicker} id="msg-pics" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple tabIndex={-1} onChange={e => addPictures(e.target.files)} />
                {(form.imageIds.length > 0 || uploading > 0) && (
                  <div className="am-pics">
                    {form.imageIds.map((id, i) => (
                      <div className="am-pic" key={id}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed-in link */}
                        <img src={`/api/admin/announcements/images/${id}`} alt={`Picture ${i + 1}`} />
                        <div className="am-pic-row">
                          <button type="button" onClick={() => movePicture(i, i - 1)} disabled={i === 0} aria-label={`Move picture ${i + 1} earlier`}><Icons.back size={18} aria-hidden="true" /></button>
                          <button type="button" onClick={() => setForm(f => ({ ...f, imageIds: f.imageIds.filter(x => x !== id) }))} aria-label={`Remove picture ${i + 1}`}><Icons.close size={16} aria-hidden="true" /></button>
                          <button type="button" onClick={() => movePicture(i, i + 1)} disabled={i === form.imageIds.length - 1} aria-label={`Move picture ${i + 1} later`}><Icons.next size={18} aria-hidden="true" /></button>
                        </div>
                      </div>
                    ))}
                    {Array.from({ length: uploading }, (_, i) => <div className="am-pic" key={i}><div className="am-pic-busy" role="status">Adding…</div></div>)}
                  </div>
                )}
                <button type="button" className="btn btn-sm btn-outline" onClick={() => filePicker.current?.click()} disabled={uploading > 0 || form.imageIds.length >= IMAGES_MAX}>
                  <Icons.image size={16} aria-hidden="true" /> Add pictures
                </button>
              </div>
            </Field>
            <Field id="msg-aud" label="Who sees it" error={errors.audience}>
              <select id="msg-aud" className="a-input" value={form.audience} aria-invalid={!!errors.audience} onChange={e => setField('audience', e.target.value as Audience)}>
                <option value="" disabled>Choose</option>
                {AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
            </Field>
            <div className="am-2col">
              <Field id="msg-start" label="From" error={errors.startDate}>
                <input id="msg-start" className="a-input" type="date" value={form.startDate} aria-invalid={!!errors.startDate} onChange={e => setField('startDate', e.target.value)} />
              </Field>
              <Field id="msg-end" label="Until (inclusive)" error={errors.endDate}>
                <input id="msg-end" className="a-input" type="date" value={form.endDate} min={form.startDate || undefined} aria-invalid={!!errors.endDate} onChange={e => setField('endDate', e.target.value)} />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {action?.kind === 'toggle' && (
        <ConfirmModal icon="bell"
          title={action.item.isActive ? `Switch off “${action.item.title}”?` : `Switch on “${action.item.title}”?`}
          body={action.item.isActive
            ? <>It stops showing straight away.</>
            : <>It shows to {AUDIENCE_LABEL[action.item.audience].toLowerCase()} every time they sign in or open the app, from {shortDate(action.item.startsAt)} to {shortDate(action.item.endsAt)}.</>}
          confirmLabel={action.item.isActive ? 'Switch off' : 'Switch on'} danger={action.item.isActive}
          busy={actionBusy} error={actionError} onConfirm={runAction} onClose={() => setAction(null)}
        />
      )}
      {action?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete “${action.item.title}”?`}
          body={<>This can’t be undone. To stop it but keep the record, switch it off instead.</>}
          confirmLabel="Delete message" danger
          busy={actionBusy} error={actionError} onConfirm={runAction} onClose={() => setAction(null)}
        />
      )}
      {toastNode}
    </>
  )
}
