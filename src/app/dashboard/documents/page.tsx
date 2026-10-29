'use client'

import { useState, useEffect, useRef, useCallback, type PointerEvent } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons, type IconName } from '@/components/ui/icons'

interface DocStatus {
  id: string
  icon: string
  label: string
  sub: string
  required: boolean
  uploaded: boolean
  fileName?: string
  /** not_uploaded | pending | approved | rejected */
  approvalStatus?: string
  rejectionReason?: string
}

const MAX_BYTES = 5 * 1024 * 1024
const DOC_ICON: Record<string, IconName> = { id: 'card', addr: 'home', guar: 'customers', agree: 'enrol', bank: 'loan' }

function stateOf(d: DocStatus) {
  if (d.approvalStatus === 'rejected') return { key: 'rejected', label: 'Needs a new file', tag: 'ag-crow-tag--due' }
  if (d.approvalStatus === 'approved') return { key: 'approved', label: 'Approved', tag: 'ag-crow-tag--ok' }
  if (d.uploaded) return { key: 'review', label: 'Under review', tag: 'ag-crow-tag--soon' }
  return { key: 'todo', label: d.required ? 'To do' : 'Optional', tag: '' }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function DocumentsPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [docs, setDocs] = useState<DocStatus[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [sheet, setSheet] = useState<'agree' | 'guar' | null>(null)
  const [guarStep, setGuarStep] = useState<'download' | 'upload'>('download')
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/documents')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setDocs(d.docs ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
      setDocs(prev => prev ?? [])
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Everything approved: the session says so, and the dashboard opens.
  useEffect(() => {
    if ((session?.user as { documentsComplete?: boolean } | undefined)?.documentsComplete) router.replace('/dashboard')
  }, [session, router])

  async function send(docType: string, fileName: string, fileData: string) {
    setBusy(docType); setError('')
    try {
      const res = await fetch('/api/agent/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, fileName, fileData }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error ?? 'That didn’t upload. Please try again.')
        return false
      }
      await load()
      await update()
      return true
    } catch {
      setError('No connection. Check your internet and try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function onFile(docType: string, file: File | undefined, done: string) {
    if (!file) return
    if (file.size > MAX_BYTES) { setError('That file is over 5 MB. Take a smaller photo or compress the PDF.'); return }
    try {
      const data = await readFile(file)
      if (await send(docType, file.name, data)) {
        setToast(done)
        if (docType === 'guar') setSheet(null)
      }
    } catch {
      setError('We couldn’t read that file. Try another one.')
    }
  }

  async function checkAgain() {
    setChecking(true)
    await Promise.all([load(), update()])
    setChecking(false)
  }

  async function downloadGuarantorForm() {
    setBusy('guar-form'); setError('')
    try {
      const res = await fetch('/api/agent/documents/guarantor-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: session?.user?.name || 'Agent' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error ?? 'The form couldn’t be made. Please try again.')
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = 'guarantor-form.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setGuarStep('upload')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(null)
    }
  }

  if (docs === null) return <div className="ag-page ag-docs"><ListSkeleton count={5} /></div>

  if (failed && docs.length === 0) {
    return (
      <div className="ag-page ag-docs">
        <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load your documents" text="Check your connection and try again."
          action={<button type="button" className="ui-btn ui-btn--secondary" onClick={() => { setDocs(null); load() }}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} /></section>
      </div>
    )
  }

  if (docs.length === 0) {
    return (
      <div className="ag-page ag-docs">
        <section className="ui-card"><EmptyState icon="check" title="No documents needed" text="Your account doesn’t need any documents."
          action={<button type="button" className="ui-btn ui-btn--primary" onClick={() => router.replace('/dashboard')}>Go to home</button>} /></section>
      </div>
    )
  }

  const required = docs.filter(d => d.required)
  const sent = required.filter(d => d.uploaded && d.approvalStatus !== 'rejected')
  const approved = required.filter(d => d.approvalStatus === 'approved')
  const rejected = docs.filter(d => d.approvalStatus === 'rejected')
  const allSent = sent.length === required.length
  const pct = required.length ? Math.round((sent.length / required.length) * 100) : 0

  const head = rejected.length > 0
    ? { title: 'Some documents need another look', text: 'Support couldn’t accept everything. Check the feedback below and send a new file.' }
    : allSent
      ? { title: 'Your documents are being reviewed', text: 'Support is checking what you sent. When everything is approved, the app opens for you here.' }
      : { title: 'Finish setting up your account', text: 'Send these documents so support can check who you are. You can start working once they’re approved.' }

  return (
    <div className="ag-page ag-docs">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <section className="ui-card ag-docs-head">
        <span className={`ag-docs-badge${allSent && !rejected.length ? ' is-review' : rejected.length ? ' is-warn' : ''}`} aria-hidden="true">
          {rejected.length ? <Icons.error size={24} /> : allSent ? <Icons.pending size={24} /> : <Icons.enrol size={24} />}
        </span>
        <h1 className="ag-docs-title">{head.title}</h1>
        <p className="ui-row-sub">{head.text}</p>
        <div className="ag-docs-progress">
          <div className="ui-progress" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={sent.length} aria-label="Documents sent">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="ag-docs-count">{sent.length} of {required.length} sent{approved.length > 0 ? ` · ${approved.length} approved` : ''}</span>
        </div>
        {allSent && !rejected.length && (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={checking} onClick={checkAgain}>
            {checking ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : <><Icons.retry size={18} aria-hidden="true" /> Check again</>}
          </button>
        )}
      </section>

      <FormError message={error} />

      <section className="ui-card ui-card--list ag-docs-list" aria-label="Your documents">
        {docs.map(doc => {
          const st = stateOf(doc)
          const Icon = Icons[DOC_ICON[doc.id] ?? 'history']
          const isBusy = busy === doc.id
          const action = doc.id === 'agree'
            ? <button type="button" className={`ui-btn ui-btn--sm ${doc.uploaded && st.key !== 'rejected' ? 'ui-btn--secondary' : 'ui-btn--primary'}`} onClick={() => { setError(''); setSheet('agree') }}>{doc.uploaded && st.key !== 'rejected' ? 'Sign again' : 'Read & sign'}</button>
            : doc.id === 'guar'
              ? <button type="button" className={`ui-btn ui-btn--sm ${doc.uploaded && st.key !== 'rejected' ? 'ui-btn--secondary' : 'ui-btn--primary'}`} onClick={() => { setError(''); setGuarStep(doc.uploaded ? 'upload' : 'download'); setSheet('guar') }}>{doc.uploaded && st.key !== 'rejected' ? 'Replace' : 'Start'}</button>
              : <>
                  <input ref={el => { fileRefs.current[doc.id] = el }} type="file" accept="image/*,application/pdf" hidden
                    onChange={e => { onFile(doc.id, e.target.files?.[0], `${doc.label} sent`); e.target.value = '' }} />
                  <button type="button" className={`ui-btn ui-btn--sm ${doc.uploaded && st.key !== 'rejected' ? 'ui-btn--secondary' : 'ui-btn--primary'}`} disabled={isBusy} onClick={() => fileRefs.current[doc.id]?.click()}>
                    {isBusy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : doc.uploaded && st.key !== 'rejected' ? 'Replace' : 'Upload'}
                  </button>
                </>
          return (
            <div key={doc.id} className="ag-doc">
              <div className="ag-doc-row">
                <span className={`ag-doc-icon is-${st.key}`} aria-hidden="true">{st.key === 'approved' ? <Icons.check size={20} /> : <Icon size={20} />}</span>
                <span className="ag-crow-main">
                  <span className="ag-crow-name">{doc.label}</span>
                  <span className="ag-crow-sub">{doc.uploaded && doc.fileName && st.key !== 'rejected' ? doc.fileName : doc.sub}</span>
                  <span className={`ag-crow-tag ${st.tag}`}>{st.label}</span>
                </span>
                {st.key !== 'approved' && <span className="ag-doc-action">{action}</span>}
              </div>
              {doc.rejectionReason && st.key === 'rejected' && (
                <p className="ag-doc-feedback"><strong>Feedback from support:</strong> {doc.rejectionReason}</p>
              )}
            </div>
          )
        })}
      </section>
      <p className="ui-note ui-note--center">Photos or PDFs, up to 5 MB each.</p>

      <BottomSheet open={sheet === 'agree'} onClose={() => { if (busy !== 'agree') setSheet(null) }} title="Agent agreement">
        <AgreementSigner busy={busy === 'agree'} onSign={async data => { if (await send('agree', 'agent-agreement-signed.png', data)) { setSheet(null); setToast('Agreement signed') } }} />
        <FormError message={sheet === 'agree' ? error : ''} />
      </BottomSheet>

      <BottomSheet open={sheet === 'guar'} onClose={() => { if (busy !== 'guar') setSheet(null) }} title="Guarantor form">
        <ol className="ag-steplist ag-guar-steps">
          {[
            'Download the form. Your name is already on it.',
            'Your guarantor prints it, fills in their details and signs.',
            'Take a clear photo or scan of the signed form and send it here.',
          ].map((t, i) => {
            const state = guarStep === 'download' ? (i === 0 ? 'current' : 'todo') : (i === 0 ? 'done' : i === 2 ? 'current' : 'todo')
            return (
              <li key={i} className={`is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="ag-steplist-dot" aria-hidden="true">{state === 'done' ? <Icons.check size={14} /> : i + 1}</span>
                <span className="ag-steplist-text"><span className="ag-steplist-title">{t}</span></span>
              </li>
            )
          })}
        </ol>
        <FormError message={sheet === 'guar' ? error : ''} />
        <div className="ui-stack">
          {guarStep === 'download' ? (
            <>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy === 'guar-form'} onClick={downloadGuarantorForm}>
                {busy === 'guar-form' ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Preparing…</> : <><Icons.download size={18} aria-hidden="true" /> Download the form</>}
              </button>
              <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => setGuarStep('upload')}>I already have a signed form</button>
            </>
          ) : (
            <>
              <input ref={el => { fileRefs.current.guar = el }} type="file" accept="image/*,application/pdf" hidden
                onChange={e => { onFile('guar', e.target.files?.[0], 'Guarantor form sent'); e.target.value = '' }} />
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy === 'guar'} onClick={() => fileRefs.current.guar?.click()}>
                {busy === 'guar' ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : <><Icons.image size={18} aria-hidden="true" /> Send the signed form</>}
              </button>
              <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => setGuarStep('download')}>Download the form again</button>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}

/** The agreement text and a signature pad. Strokes follow the finger at any screen size; a blank pad can't be sent. */
function AgreementSigner({ busy, onSign }: { busy: boolean; onSign: (png: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [agreed, setAgreed] = useState(false)

  // Match the canvas's pixels to its size on screen, so strokes land under the finger.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const fit = () => {
      const r = c.getBoundingClientRect()
      if (!r.width) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      const ctx = c.getContext('2d')
      if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f2a1d' }
      setHasInk(false)
    }
    // The pad sits in a sheet that starts hidden, so re-fit whenever it gets (or changes) a size on screen.
    let last = 0
    const ro = new ResizeObserver(() => { const w = c.getBoundingClientRect().width; if (w && w !== last) { last = w; fit() } })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = point(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return
    const p = point(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!hasInk) setHasInk(true)
  }
  function up() { drawing.current = false }
  function clear() {
    const c = canvasRef.current; const ctx = c?.getContext('2d')
    if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore() }
    setHasInk(false)
  }

  return (
    <>
      <div className="ag-doc-terms" tabIndex={0} aria-label="Agreement text">
        <h3>Vochus Easy Save Agent Terms &amp; Conditions</h3>
        <p><strong>1. Agreement to terms.</strong> By becoming an agent for Vochus Easy Save, you agree to comply with all terms and conditions outlined in this agreement. This includes all operational guidelines, compliance requirements, and financial obligations.</p>
        <p><strong>2. Agent responsibilities.</strong> As an agent, you are responsible for: enrolling customers, recording savings transactions, maintaining accurate records, safeguarding customer funds, and reporting all transactions promptly. You must conduct all activities in accordance with applicable laws and platform policies.</p>
        <p><strong>3. Commission structure.</strong> Agents earn commission based on savings volume (0.4% of savings amount) and customer enrolments (₦2 per enrolment). Commission is calculated monthly and deposited into your agent wallet.</p>
        <p><strong>4. Float limit.</strong> You are allocated a float limit as specified during activation. You are responsible for safeguarding all funds up to this limit and must account for every transaction.</p>
        <p><strong>5. Compliance &amp; conduct.</strong> You must comply with all KYC/AML requirements, maintain confidentiality of customer information, and conduct business with integrity. Any fraudulent activity will result in immediate account suspension and legal action.</p>
        <p><strong>6. Termination.</strong> Vochus reserves the right to terminate this agreement at any time if you violate terms, engage in misconduct, or fail to meet performance standards.</p>
        <p><strong>7. Liability.</strong> You acknowledge that you are an independent agent and not an employee. You are solely responsible for any losses or disputes arising from your activities.</p>
      </div>

      <div className="ag-sign-head">
        <span className="ag-label">Sign here</span>
        <button type="button" className="ui-link" onClick={clear} disabled={!hasInk}>Clear</button>
      </div>
      <canvas ref={canvasRef} className="ag-sign-pad" aria-label="Signature pad. Draw your signature with your finger or mouse."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />

      <button type="button" role="checkbox" aria-checked={agreed} className={`ag-agree${agreed ? ' is-on' : ''}`} onClick={() => setAgreed(a => !a)}>
        <span className="ag-agree-box" aria-hidden="true">{agreed && <Icons.check size={16} />}</span>
        <span>I’ve read the agreement above and agree to it.</span>
      </button>

      <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-sign-btn" disabled={busy || !hasInk || !agreed}
        onClick={() => { const c = canvasRef.current; if (c) onSign(c.toDataURL('image/png')) }}>
        {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Signing…</> : !hasInk ? 'Sign above to continue' : 'Sign agreement'}
      </button>
    </>
  )
}
