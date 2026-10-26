'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface DocStatus {
  id: string
  icon: string
  label: string
  sub: string
  required: boolean
  uploaded: boolean
  fileName?: string
  approvalStatus?: string
  rejectionReason?: string
}

export default function DocumentsPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [docs, setDocs] = useState<DocStatus[]>([])
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [showAgreement, setShowAgreement] = useState(false)
  const [agreementSigned, setAgreementSigned] = useState(false)
  const [signingAgreement, setSigningAgreement] = useState(false)
  const [showGuarantorForm, setShowGuarantorForm] = useState(false)
  const [signingGuarantor, setSigningGuarantor] = useState(false)
  const [guarantorFormDownloaded, setGuarantorFormDownloaded] = useState(false)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const signaturePadRef = useRef<HTMLCanvasElement>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  useEffect(() => {
    Promise.all([
      fetch('/api/agent/documents').then(r => r.ok ? r.json() : { docs: [] }),
      fetch('/api/agent').then(r => r.ok ? r.json() : { agent: null }),
    ])
      .then(([docsRes, agentRes]) => {
        setDocs(docsRes.docs ?? [])
        setAgent(agentRes.agent)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if ((session?.user as any)?.documentsComplete) {
      window.location.href = '/dashboard'
    }
  }, [session])

  async function handleUpload(docId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 5 * 1024 * 1024) { showToast('File too large — max 5MB'); return }
    setUploading(docId)

    const reader = new FileReader()
    reader.onload = async ev => {
      const fileData = ev.target?.result as string
      const res = await fetch('/api/agent/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: docId, fileName: file.name, fileData }),
      })
      setUploading(null)
      if (res.ok) {
        showToast('✅ Document uploaded')
        const docsRes = await fetch('/api/agent/documents').then(r => r.ok ? r.json() : { docs: [] })
        setDocs(docsRes.docs ?? [])
        await update()
        checkAllComplete()
      } else {
        const d = await res.json().catch(() => ({}))
        showToast((d as any).error ?? 'Upload failed')
      }
    }
    reader.readAsDataURL(file)
  }

  function checkAllComplete() {
    const required = docs.filter(d => d.required)
    const agreementDoc = docs.find(d => d.id === 'agree')
    const otherDocs = required.filter(d => d.id !== 'agree')
    const otherComplete = otherDocs.length > 0 && otherDocs.every(d => d.uploaded)
    const agreementComplete = agreementDoc ? agreementSigned : true

    if (otherComplete && agreementComplete) {
      setTimeout(() => router.replace('/dashboard'), 1200)
    }
  }

  async function signAgreement() {
    const canvas = signaturePadRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx || ctx.globalCompositeOperation === 'destination-out') {
      showToast('Please sign the agreement')
      return
    }

    setSigningAgreement(true)
    const signatureData = canvas.toDataURL()

    const res = await fetch('/api/agent/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: 'agree', fileName: 'agent-agreement-signed.png', fileData: signatureData }),
    })

    setSigningAgreement(false)
    if (res.ok) {
      setAgreementSigned(true)
      setShowAgreement(false)
      setDocs(prev => prev.map(d => d.id === 'agree' ? { ...d, uploaded: true, fileName: 'Signed' } : d))
      showToast('✅ Agreement signed')
      await update()
      checkAllComplete()
    } else {
      showToast('Failed to sign agreement')
    }
  }

  function clearSignature() {
    const canvas = signaturePadRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }

  function startDrawing(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = signaturePadRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    let x, y
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left
      y = e.touches[0].clientY - rect.top
    } else {
      x = e.clientX - rect.left
      y = e.clientY - rect.top
    }

    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = signaturePadRef.current
    if (!canvas) return

    if ('touches' in e) {
      if (e.touches.length === 0) return
    } else if (e.buttons !== 1) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    let x, y
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left
      y = e.touches[0].clientY - rect.top
    } else {
      x = e.clientX - rect.left
      y = e.clientY - rect.top
    }

    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function endDrawing() {
    const canvas = signaturePadRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.closePath()
  }

  async function generateGuarantorForm() {
    const agentName = (session?.user as any)?.name || 'Agent'
    const res = await fetch('/api/agent/documents/guarantor-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName }),
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `guarantor-form.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      showToast('✅ PDF downloaded. Send to your guarantor to fill in and sign.')
      return true
    } else {
      try {
        const err = await res.json()
        showToast(`Error: ${err.error || 'Failed to generate form'}`)
      } catch {
        showToast('Failed to generate form - please try again')
      }
      return false
    }
  }

  async function uploadSignedGuarantorForm(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large — max 5MB')
      return
    }

    setSigningGuarantor(true)
    const reader = new FileReader()
    reader.onload = async ev => {
      const fileData = ev.target?.result as string
      const res = await fetch('/api/agent/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: 'guar', fileName: file.name, fileData }),
      })
      setSigningGuarantor(false)
      if (res.ok) {
        setShowGuarantorForm(false)
        setGuarantorFormDownloaded(false)
        setDocs(prev => prev.map(d => d.id === 'guar' ? { ...d, uploaded: true, fileName: file.name, approvalStatus: 'pending_approval' } : d))
        showToast('✅ Signed form uploaded')
        await update()
        checkAllComplete()
      } else {
        showToast('Failed to upload form')
      }
    }
    reader.readAsDataURL(file)
  }

  const required = docs.filter(d => d.required)
  const uploadedRequired = required.filter(d => d.uploaded)
  const allComplete = required.length > 0 && uploadedRequired.length === required.length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', fontFamily: 'IBM Plex Sans, sans-serif', color: '#8aaa94' }}>
        Loading…
      </div>
    )
  }

  const allUploaded = docs.length > 0 && docs.filter(d => d.required).every(d => d.uploaded)
  const hasRejected = docs.some(d => d.approvalStatus === 'rejected')

  if (allUploaded && !hasRejected) {
    const allApproved = docs.filter(d => d.required).every(d => d.approvalStatus === 'approved')
    if (!allApproved) {
      return (
        <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center', fontFamily: 'IBM Plex Sans, sans-serif', padding: '0 16px' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#1a1a2e' }}>Documents Under Review</div>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 1.6 }}>
            Thank you for submitting your documents. Our team is currently reviewing them. You'll receive an email notification once your documents have been approved, and you'll be able to access the platform.
          </p>
          <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 12, padding: 16, marginBottom: 24, textAlign: 'left', fontSize: 13, color: '#666' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>What happens next?</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Our team reviews your submitted documents</li>
              <li>We verify all required information</li>
              <li>You'll be notified via email when approved</li>
              <li>Access to the platform will be granted automatically</li>
            </ul>
          </div>
          <div style={{ fontSize: 12, color: '#999' }}>
            Average review time: 24-48 hours
          </div>
        </div>
      )
    }
  }

  if (docs.length === 0) {
    return (
      <div style={{ maxWidth: 600, margin: '40px auto', textAlign: 'center', fontFamily: 'IBM Plex Sans, sans-serif' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No documents required</div>
        <button className="btn btn-green" onClick={() => router.replace('/dashboard')}>Go to Dashboard →</button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '8px 0' }}>
      <style>{`
        @media (max-width: 768px) {
          .agreement-modal {
            max-width: 95vw !important;
            max-height: 95vh !important;
          }
          .agreement-modal-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
            padding: 16px !important;
          }
          .agreement-text {
            border-right: none !important;
            padding-right: 0 !important;
            margin-bottom: 16px;
            max-height: none !important;
          }
          .agreement-modal-header {
            padding: 16px !important;
            flex-direction: column;
            align-items: flex-start !important;
            gap: 8px;
          }
          .agreement-modal-header > div:last-child {
            margin-left: auto;
          }
        }
      `}</style>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>Document Verification Required</h1>
        <p style={{ fontSize: 14, color: 'var(--text3)', margin: 0, lineHeight: 1.6 }}>
          Before you can access the platform, please upload the documents below. All required documents must be submitted.
        </p>
      </div>

      <div style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 6 }}>Upload Progress</div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${required.length ? (uploadedRequired.length / required.length) * 100 : 0}%`, background: 'var(--green)', borderRadius: 8, transition: 'width .4s' }} />
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: allComplete ? 'var(--green)' : 'var(--text)', fontFamily: "'IBM Plex Serif', serif", flexShrink: 0 }}>
          {uploadedRequired.length} / {required.length}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {docs.map(doc => (
          <div key={doc.id}>
            <div style={{ border: `1.5px solid ${doc.approvalStatus === 'rejected' ? '#ef5350' : doc.approvalStatus === 'approved' ? 'var(--green)' : doc.uploaded ? 'var(--border)' : 'var(--border)'}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: doc.approvalStatus === 'rejected' ? 'rgba(239,83,80,.05)' : doc.uploaded ? 'rgba(34,139,80,.04)' : 'var(--surface)' }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: doc.approvalStatus === 'rejected' ? 'rgba(239,83,80,.1)' : doc.uploaded ? 'rgba(34,139,80,.1)' : '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{doc.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {doc.label}
                  {!doc.required && <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 7px', color: 'var(--text3)', fontWeight: 400 }}>Optional</span>}
                  {doc.approvalStatus === 'approved' && <span style={{ fontSize: 11, background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 5, padding: '1px 7px', color: '#155724', fontWeight: 600 }}>✓ Approved</span>}
                  {doc.approvalStatus === 'pending' && doc.uploaded && <span style={{ fontSize: 11, background: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: 5, padding: '1px 7px', color: '#856404', fontWeight: 600 }}>⏳ Pending</span>}
                  {doc.approvalStatus === 'rejected' && <span style={{ fontSize: 11, background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 5, padding: '1px 7px', color: '#721c24', fontWeight: 600 }}>✕ Rejected</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                  {doc.uploaded ? <span style={{ color: doc.approvalStatus === 'rejected' ? '#c62828' : 'var(--green)', fontWeight: 600 }}>✓ {doc.fileName ?? 'Signed'}</span> : doc.sub}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {doc.id === 'agree' ? (
                  <button
                    className={`btn btn-sm ${doc.uploaded ? 'btn-outline' : 'btn-primary'}`}
                    onClick={() => setShowAgreement(true)}
                    style={{ minWidth: 90 }}
                  >
                    {doc.uploaded ? '✓ Signed' : 'Open & Sign'}
                  </button>
                ) : doc.id === 'guar' ? (
                  <button
                    className={`btn btn-sm ${doc.uploaded ? 'btn-outline' : 'btn-primary'}`}
                    onClick={() => setShowGuarantorForm(true)}
                    style={{ minWidth: 90 }}
                  >
                    {doc.uploaded ? '✓ Signed' : 'Open & Sign'}
                  </button>
                ) : (
                  <>
                    <input
                      ref={el => { fileRefs.current[doc.id] = el }}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      style={{ display: 'none' }}
                      onChange={e => handleUpload(doc.id, e)}
                    />
                    <button
                      className={`btn btn-sm ${doc.uploaded ? 'btn-outline' : 'btn-primary'}`}
                      disabled={uploading === doc.id}
                      onClick={() => fileRefs.current[doc.id]?.click()}
                      style={{ minWidth: 90 }}
                    >
                      {uploading === doc.id ? '…' : doc.uploaded ? '↻ Replace' : 'Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {doc.rejectionReason && (
              <div style={{ background: '#ffebee', border: '1px solid #ef5350', borderRadius: 10, padding: 12, marginTop: 8, fontSize: 12, color: '#c62828' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Feedback:</div>
                <div>{doc.rejectionReason}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {allComplete && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>All documents submitted!</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Your account is ready. Click below to access the dashboard.</div>
          <button className="btn btn-green" onClick={async () => { await update(); window.location.href = '/dashboard' }}>Access Dashboard →</button>
        </div>
      )}

      {showAgreement && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setShowAgreement(false)}>
          <div className="agreement-modal" style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="agreement-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>Agent Agreement</div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>Read and sign the Vochus Easy Save Agent Terms & Conditions</div>
              </div>
              <button onClick={() => setShowAgreement(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {/* Content */}
            <div className="agreement-modal-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: 28, overflowY: 'auto' }}>
              {/* Agreement Text */}
              <div className="agreement-text" style={{ borderRight: '1px solid #e5e7eb', paddingRight: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 200px)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 12, color: '#1a1a2e' }}>Vochus Easy Save Agent Terms & Conditions</h3>

                <div style={{ fontSize: 13, lineHeight: 1.7, color: '#333' }}>
                  <p><strong>1. AGREEMENT TO TERMS</strong></p>
                  <p>By becoming an agent for Vochus Easy Save, you agree to comply with all terms and conditions outlined in this agreement. This includes all operational guidelines, compliance requirements, and financial obligations.</p>

                  <p><strong>2. AGENT RESPONSIBILITIES</strong></p>
                  <p>As an agent, you are responsible for: enrolling customers, recording savings transactions, maintaining accurate records, safeguarding customer funds, and reporting all transactions promptly. You must conduct all activities in accordance with applicable laws and platform policies.</p>

                  <p><strong>3. COMMISSION STRUCTURE</strong></p>
                  <p>Agents earn commission based on savings volume (0.4% of savings amount) and customer enrolments (₦2 per enrolment). Commission is calculated monthly and deposited into your agent wallet.</p>

                  <p><strong>4. FLOAT LIMIT</strong></p>
                  <p>You are allocated a float limit as specified during activation. You are responsible for safeguarding all funds up to this limit and must account for every transaction.</p>

                  <p><strong>5. COMPLIANCE & CONDUCT</strong></p>
                  <p>You must comply with all KYC/AML requirements, maintain confidentiality of customer information, and conduct business with integrity. Any fraudulent activity will result in immediate account suspension and legal action.</p>

                  <p><strong>6. TERMINATION</strong></p>
                  <p>Vochus reserves the right to terminate this agreement at any time if you violate terms, engage in misconduct, or fail to meet performance standards.</p>

                  <p style={{ marginBottom: 0 }}><strong>7. LIABILITY</strong></p>
                  <p style={{ marginBottom: 0 }}>You acknowledge that you are an independent agent and not an employee. You are solely responsible for any losses or disputes arising from your activities.</p>
                </div>
              </div>

              {/* Signature Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 8, color: '#1a1a2e' }}>Your Signature *</label>
                  <canvas
                    ref={signaturePadRef}
                    width={400}
                    height={180}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={endDrawing}
                    onMouseLeave={endDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={endDrawing}
                    style={{
                      border: '2px solid #d1d5db',
                      borderRadius: 10,
                      background: '#fafafa',
                      cursor: 'crosshair',
                      display: 'block',
                      width: '100%',
                      maxWidth: '100%',
                      touchAction: 'none',
                    }}
                  />
                  <button
                    onClick={clearSignature}
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: '#666',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: 0,
                    }}
                  >
                    Clear and redraw
                  </button>
                </div>

                <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: 12, fontSize: 12, color: '#2e7d4f' }}>
                  ✓ By signing, you confirm that you have read and agree to all terms above.
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
                  <button
                    onClick={() => setShowAgreement(false)}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#1a1a2e',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={signAgreement}
                    disabled={signingAgreement}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: signingAgreement ? '#ccc' : '#1a5c35',
                      border: 'none',
                      borderRadius: 8,
                      cursor: signingAgreement ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                    }}
                  >
                    {signingAgreement ? 'Signing…' : '✓ Sign Agreement'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGuarantorForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }} onClick={() => setShowGuarantorForm(false)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: '90vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid #e5e7eb', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'clamp(16px, 4vw, 18px)', fontWeight: 800, color: '#1a1a2e' }}>Guarantor Form</div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>Download form for your guarantor to sign</div>
              </div>
              <button onClick={() => setShowGuarantorForm(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, padding: '16px', width: '100%', maxWidth: 600, margin: '0 auto', boxSizing: 'border-box' }}>
              {!guarantorFormDownloaded ? (
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 16, color: '#1a1a2e' }}>Download Guarantor Form</h3>
                  <p style={{ fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.6 }}>
                    A blank guarantor form will be generated. Download it and send to your guarantor to:
                  </p>
                  <ul style={{ fontSize: 13, color: '#666', marginBottom: 20, paddingLeft: 24, lineHeight: 1.8 }}>
                    <li>Print the form</li>
                    <li>Fill in their details (name, phone, address)</li>
                    <li>Sign the document</li>
                    <li>Return it to you</li>
                  </ul>
                  <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: 12, fontSize: 12, color: '#2e7d4f', marginBottom: 24 }}>
                    ℹ️ Your agent name is already filled in on the form. Your guarantor just needs to add their details and sign.
                  </div>
                  <button
                    onClick={async () => {
                      const success = await generateGuarantorForm()
                      if (success) setGuarantorFormDownloaded(true)
                    }}
                    disabled={signingGuarantor}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: signingGuarantor ? '#ccc' : '#1a5c35',
                      border: 'none',
                      borderRadius: 8,
                      cursor: signingGuarantor ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                    }}
                  >
                    {signingGuarantor ? 'Generating…' : '📥 Download Form'}
                  </button>
                </div>
              ) : (
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 16, color: '#1a1a2e' }}>Upload Signed Form</h3>
                  <p style={{ fontSize: 13, color: '#666', marginBottom: 20, lineHeight: 1.6 }}>
                    Once your guarantor has signed and returned the form, upload it here.
                  </p>
                  <div
                    onClick={() => fileRefs.current['guar_signed']?.click()}
                    style={{
                      border: '2px dashed #d1d5db',
                      borderRadius: 10,
                      padding: '20px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#fafafa',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as any
                      el.style.backgroundColor = '#f3f4f6'
                      el.style.borderColor = '#999'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as any
                      el.style.backgroundColor = '#fafafa'
                      el.style.borderColor = '#d1d5db'
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', marginBottom: 4 }}>Click to upload signed form</div>
                    <div style={{ fontSize: 12, color: '#666' }}>PDF, JPG, PNG (max 5MB)</div>
                  </div>
                  <input
                    ref={el => fileRefs.current['guar_signed'] = el}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={uploadSignedGuarantorForm}
                    style={{ display: 'none' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button
                  onClick={() => {
                    setShowGuarantorForm(false)
                    setGuarantorFormDownloaded(false)
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    background: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1a1a2e',
                  }}
                >
                  Cancel
                </button>
                {guarantorFormDownloaded && (
                  <button
                    onClick={() => setGuarantorFormDownloaded(false)}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#1a1a2e',
                    }}
                  >
                    ← Back
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1a1a2e', color: '#fff', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 999, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
