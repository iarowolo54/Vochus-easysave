'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { AGENT_DOCS, agentDocLabel } from '@/lib/agent-documents'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-safety'
import { ConfirmModal, LoadError, TableSkeleton, shortDate, useToast } from './admin-ui'

interface AgentDoc {
  docType: string
  fileName: string
  uploadedAt: string
  docApprovalStatus: string
  docRejectionReason: string | null
}

interface EarlierFile { id: string; docType: string; fileName: string; replacedAt: string; replacedBy: string }

interface Picked { docType: string; fileName: string; fileData: string; current: AgentDoc | null }

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function DocBadge({ doc, required }: { doc: AgentDoc | undefined; required: boolean }) {
  if (!doc) return required ? <span className="bdg bdg-a">Missing</span> : <span className="bdg bdg-grey">Not uploaded</span>
  if (doc.docApprovalStatus === 'approved') return <span className="bdg bdg-g">Approved</span>
  if (doc.docApprovalStatus === 'rejected') return <span className="bdg bdg-r">Rejected</span>
  return <span className="bdg bdg-a">To review</span>
}

function afterUploadNote(current: AgentDoc | null) {
  if (!current) return 'It will then wait for approval under Review documents on the Agents page.'
  if (current.docApprovalStatus === 'approved') return 'The current file moves to Earlier files. The new one stays approved.'
  return 'The current file moves to Earlier files. The new one will wait for approval under Review documents on the Agents page.'
}

export function AgentDocumentsTab({ agentId, onCount }: { agentId: string; onCount: (n: number) => void }) {
  const [docs, setDocs] = useState<AgentDoc[]>([])
  const [required, setRequired] = useState<string[]>([])
  const [earlier, setEarlier] = useState<EarlierFile[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pickError, setPickError] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [toastNode, toast] = useToast()
  const input = useRef<HTMLInputElement>(null)
  const pickingFor = useRef('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/documents`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { documents?: AgentDoc[]; required?: string[]; versions?: EarlierFile[]; canManage?: boolean }
      setEarlier(d.versions ?? [])
      setDocs(d.documents ?? []); setRequired(d.required ?? []); setCanManage(!!d.canManage)
      onCount(d.documents?.length ?? 0)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [agentId, onCount])

  useEffect(() => { load() }, [load])

  function choose(docType: string) {
    pickingFor.current = docType
    setPickError('')
    input.current?.click()
  }

  async function onFile(file: File | undefined) {
    if (input.current) input.current.value = ''
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) { setPickError('That file is over 5 MB. Choose a smaller photo or compress the PDF.'); return }
    try {
      const fileData = await readAsDataUrl(file)
      const docType = pickingFor.current
      setSaveError('')
      setPicked({ docType, fileName: file.name, fileData, current: docs.find(d => d.docType === docType) ?? null })
    } catch {
      setPickError('We couldn’t read that file. Try choosing it again.')
    }
  }

  async function save() {
    if (!picked) return
    setSaving(true); setSaveError('')
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/documents/${encodeURIComponent(picked.docType)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: picked.fileName, fileData: picked.fileData }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; document?: AgentDoc }
      if (!res.ok || !d.document) { setSaveError(d.error ?? 'The file wasn’t saved. Nothing changed. Try again.'); return }
      const next = [...docs.filter(x => x.docType !== picked.docType), d.document]
      setDocs(next)
      onCount(next.length)
      toast(`${agentDocLabel(picked.docType)} saved`, 'success')
      setPicked(null)
      if (picked.current) load()
    } catch {
      setSaveError('No connection. We can’t tell if the file was saved, so reload before trying again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="card"><TableSkeleton rows={5} cols={3} /></section>
  if (failed) return <section className="card"><LoadError what="this agent’s documents" onRetry={load} /></section>

  const extras = [...new Set([...required, ...docs.map(d => d.docType)])].filter(t => !AGENT_DOCS.some(d => d.id === t))
  const rows = [...AGENT_DOCS.map(d => d.id as string), ...extras]

  return (
    <section className="card" aria-label="Documents">
      {pickError && <p className="a-alert a-alert-r" role="alert">{pickError}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden
        aria-label="Choose a file" onChange={e => onFile(e.target.files?.[0])} />
      <div className="rows">
        {rows.map(docType => {
          const doc = docs.find(d => d.docType === docType)
          const label = agentDocLabel(docType)
          const older = earlier.filter(e => e.docType === docType)
          return (
            <div key={docType} className="row ag-review-row">
              <span className="row-ic" aria-hidden="true"><Icons.enrol size={18} /></span>
              <div className="row-main">
                <div className="row-title">{label}</div>
                {doc && <div className="row-sub">{doc.fileName} · {shortDate(doc.uploadedAt)}</div>}
                {doc?.docApprovalStatus === 'rejected' && doc.docRejectionReason && <div className="row-sub">Reason: {doc.docRejectionReason}</div>}
                <DocBadge doc={doc} required={required.includes(docType)} />
                {older.length > 0 && (
                  <details className="ag-doc-earlier">
                    <summary>Earlier files ({older.length})</summary>
                    <ul className="am-batch">
                      {older.map(e => (
                        <li key={e.id} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{e.fileName}<br /><span className="row-sub" style={{ whiteSpace: 'normal' }}>Replaced {shortDate(e.replacedAt)} by {e.replacedBy}</span></span>
                          <a href={`/api/admin/agents/${agentId}/documents/${encodeURIComponent(docType)}/versions/${e.id}`} target="_blank" rel="noopener noreferrer"
                            className="btn btn-sm btn-outline" aria-label={`View earlier ${label}: ${e.fileName}`}>View</a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="row-actions">
                {doc && (
                  <a href={`/api/admin/agents/${agentId}/documents/${encodeURIComponent(docType)}`} target="_blank" rel="noopener noreferrer"
                    className="btn btn-sm btn-outline" aria-label={`View ${label}`}>View</a>
                )}
                {canManage && (
                  <button type="button" className="btn btn-sm btn-soft" onClick={() => choose(docType)}
                    aria-label={`${doc ? 'Replace' : 'Add'} ${label}`}>{doc ? 'Replace' : 'Add'}</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {picked && (
        <ConfirmModal icon="enrol" title={`${picked.current ? 'Replace' : 'Add'} ${agentDocLabel(picked.docType).toLowerCase()}?`}
          confirmLabel={picked.current ? 'Replace file' : 'Add file'} busy={saving} error={saveError}
          footnote={<><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</>}
          body={<>
            <dl className="dlg-ledger">
              {picked.current && <div><dt>Current file</dt><dd>{picked.current.fileName}</dd></div>}
              <div><dt>New file</dt><dd className="dlg-strong">{picked.fileName}</dd></div>
            </dl>
            <p className="dlg-note">{afterUploadNote(picked.current)}</p>
          </>}
          onConfirm={save} onClose={() => setPicked(null)} />
      )}

      {toastNode}
    </section>
  )
}
