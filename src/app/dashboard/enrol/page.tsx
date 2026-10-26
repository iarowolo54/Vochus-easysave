'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { blockMinus, blockNonDigit, digitsOnly, nonNegativeString } from '@/lib/numeric'

interface PlanDraft {
  dailyAmount: string; periodDays: string; goal: string; startDate: string; notes: string; cadence: 'daily' | 'weekly' | 'monthly'
}

interface FormData {
  firstName: string; lastName: string; phone: string; email: string; dob: string
  address: string; state: string; language: string; bvn: string
  nokName: string; nokRelation: string; nokPhone: string
  dailyAmount: string; periodDays: string; goal: string; startDate: string; notes: string; cadence: 'daily' | 'weekly' | 'monthly'
  plans: PlanDraft[]
  agreed: boolean
  nfcCard: string; registrationFee: string; feeMethod: string
}

const empty: FormData = {
  firstName: '', lastName: '', phone: '', email: '', dob: '',
  address: '', state: '', language: 'English', bvn: '',
  nokName: '', nokRelation: 'Spouse', nokPhone: '',
  dailyAmount: '', periodDays: '', goal: '', startDate: '', notes: '', cadence: 'daily',
  plans: [],
  agreed: false,
  nfcCard: '', registrationFee: '500', feeMethod: 'cash',
}

export default function EnrolPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const walletBalance = (session?.user as any)?.walletBalance ?? 0
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(empty)
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // QR scanner state
  const [qrScanActive, setQrScanActive] = useState(false)
  const [qrStreamReady, setQrStreamReady] = useState(false)
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrAnimRef = useRef<number>(0)

  async function startQrScan() {
    setQrError('')
    setQrStreamReady(false)
    setQrScanActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      qrStreamRef.current = stream
      setQrStreamReady(true)
    } catch {
      setQrError('Camera access denied')
      setQrScanActive(false)
    }
  }

  function stopQrScan() {
    cancelAnimationFrame(qrAnimRef.current)
    qrStreamRef.current?.getTracks().forEach(t => t.stop())
    qrStreamRef.current = null
    setQrStreamReady(false)
    setQrScanActive(false)
  }

  useEffect(() => {
    if (!qrStreamReady || !qrVideoRef.current || !qrStreamRef.current) return
    const video = qrVideoRef.current
    video.srcObject = qrStreamRef.current
    video.setAttribute('playsinline', 'true')
    video.muted = true
    video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    let running = true

    function tick() {
      if (!running) return
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        import('jsqr').then(({ default: jsQR }) => {
          const code = jsQR(imageData.data, imageData.width, imageData.height)
          if (code?.data) {
            set('nfcCard', code.data)
            stopQrScan()
          }
        })
      }
      qrAnimRef.current = requestAnimationFrame(tick)
    }
    qrAnimRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(qrAnimRef.current) }
  }, [qrStreamReady])

  useEffect(() => () => { qrStreamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  // Phone verification state
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [devCode, setDevCode] = useState('')

  useEffect(() => {
    if (otpCooldown <= 0) return
    const t = setTimeout(() => setOtpCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [otpCooldown])

  useEffect(() => {
    if (step !== 2 || otpSent || otpLoading) return
    setOtpLoading(true)
    fetch('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: form.phone.replace(/\s/g, '') }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) { setOtpSent(true); setOtpCooldown(60); if (data._devCode) setDevCode(data._devCode) }
        else setOtpError(data.error ?? 'Failed to send OTP')
      })
      .catch(() => setOtpError('Network error sending OTP'))
      .finally(() => setOtpLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [cameraActive])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraActive(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  async function startCamera() {
    setCameraError('')
    setPhotoDataUrl(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: 640, height: 480 } })
      streamRef.current = stream
      setCameraActive(true)
    } catch {
      setCameraError('Camera access denied or not available. Please upload from gallery instead.')
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.9))
    stopCamera()
  }

  function retake() {
    setPhotoDataUrl(null)
    startCamera()
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPhotoDataUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const set = (k: keyof FormData, v: any) => setForm(f => ({ ...f, [k]: v }))

  function onPhoneChange(val: string) {
    set('phone', digitsOnly(val).slice(0, 11))
    if (phoneVerified) { setPhoneVerified(false); setOtpSent(false); setOtpCode(''); setOtpError('') }
  }

  async function sendOTP() {
    setOtpError('')
    setOtpLoading(true)
    const res = await fetch('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: form.phone.replace(/\s/g, '') }),
    })
    const data = await res.json()
    setOtpLoading(false)
    if (!res.ok) { setOtpError(data.error); return }
    setOtpSent(true)
    setOtpCooldown(60)
    if (data._devCode) setDevCode(data._devCode)
  }

  async function verifyOTP() {
    setOtpError('')
    setOtpLoading(true)
    const res = await fetch('/api/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: form.phone.replace(/\s/g, ''), code: otpCode }),
    })
    const data = await res.json()
    setOtpLoading(false)
    if (!res.ok) { setOtpError(data.error); return }
    setPhoneVerified(true)
    setOtpSent(false)
  }

  const maturityDate = () => {
    if (!form.startDate || !form.periodDays) return ''
    const d = new Date(form.startDate)
    d.setDate(d.getDate() + parseInt(form.periodDays))
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const target = () => {
    if (!form.dailyAmount || !form.periodDays) return 0
    const rawAmt = parseFloat(form.dailyAmount)
    const dailyEquiv = form.cadence === 'weekly' ? rawAmt / 7 : form.cadence === 'monthly' ? rawAmt / 30 : rawAmt
    return Math.round(dailyEquiv * parseInt(form.periodDays))
  }

  async function submit() {
    if (submittingRef.current) return
    if (!form.agreed) { setError('Tick the terms & conditions box to continue.'); return }
    submittingRef.current = true
    setLoading(true)
    setError('')
    try {
      const first = form.plans[0]
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          photoUrl: photoDataUrl,
          plans: form.plans.map(p => {
            const ra = parseFloat(p.dailyAmount || '0')
            const de = p.cadence === 'weekly' ? ra / 7 : p.cadence === 'monthly' ? ra / 30 : ra
            return { ...p, dailyAmount: String(de) }
          }),
          // legacy single-plan fields — populated from first plan for API back-compat
          dailyAmount: (() => { const ra = parseFloat((first?.dailyAmount ?? form.dailyAmount) || '0'); const c = first?.cadence ?? form.cadence; return String(c === 'weekly' ? ra / 7 : c === 'monthly' ? ra / 30 : ra) })(),
          periodDays: first?.periodDays ?? form.periodDays,
          goal: first?.goal ?? form.goal,
          startDate: first?.startDate ?? form.startDate,
          notes: first?.notes ?? form.notes,
          cadence: first?.cadence ?? form.cadence,
        }),
      })
      let data: any = null
      try { data = await res.json() } catch { data = null }
      if (!res.ok) {
        const msg = data?.error || `Server responded ${res.status} ${res.statusText}`.trim()
        setError(msg || 'Failed to create customer')
        submittingRef.current = false
        setLoading(false)
        return
      }
      setToast(`Customer ${form.firstName} ${form.lastName} enrolled successfully! ID: ${data.customer.customerId}`)
      setTimeout(() => router.push('/dashboard/customers'), 2000)
      // leave loading=true so button stays disabled through the redirect delay
    } catch (e: any) {
      setError(e?.message ? `Network error: ${e.message}` : 'Network error. Please try again.')
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <>
      {walletBalance <= 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 32, maxWidth: 380, width: '100%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,.18)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💼</div>
            <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 10, color: '#111' }}>Fund Your Wallet</div>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 1.6 }}>
              To use this service you must fund your agent wallet.
            </p>
            <button
              className="btn btn-g"
              style={{ width: '100%', padding: '13px 0', fontSize: 15, fontWeight: 700, marginBottom: 12 }}
              onClick={() => router.push('/dashboard/wallet')}
            >
              💼 Fund Wallet
            </button>
            <button
              style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer' }}
              onClick={() => router.back()}
            >
              Go back
            </button>
          </div>
        </div>
      )}
      <div className="page-header">
        <h2>Enrol Customer</h2>
        <p>Register a new customer into the Vochus Easy Save platform</p>
      </div>

      {toast && (
        <div className="alert alert-g" style={{ marginBottom: 16, fontWeight: 600 }}>✅ {toast}</div>
      )}
      {error && (
        <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>
      )}

      <div className="steps-h">
        {[1,2,3,4,5,6].map((n, i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: n < 6 ? 1 : undefined }}>
            <div className="step-node">
              <div className={`step-circle${n < step ? ' done' : n === step ? ' current' : ''}`} style={n > step ? { opacity: 0.5 } : undefined}>
                {n < step ? '✓' : n}
              </div>
              <div className={`step-lbl${n === step ? ' active' : ''}`} style={n > step ? { opacity: 0.5 } : undefined}>
                {['Profile','Verify Phone','Photo','Savings Plan','Card & Fee','Confirm'][i]}
              </div>
            </div>
            {n < 6 && <div className={`step-line${n < step ? ' done' : ''}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <div className="grid g-2-1">
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Personal Details</div>
                <div className="form-row fr2">
                  <div><label className="flabel">First Name *</label><input className="finput" placeholder="Ngozi" value={form.firstName} onChange={e => set('firstName', e.target.value)} /></div>
                  <div><label className="flabel">Last Name *</label><input className="finput" placeholder="Eze" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></div>
                </div>

                <div className="form-row">
                  <label className="flabel">Phone Number *</label>
                  <input
                    className="finput"
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="080XXXXXXXX"
                    value={form.phone}
                    onKeyDown={blockNonDigit}
                    onChange={e => onPhoneChange(e.target.value)}
                  />
                </div>

                <div className="form-row fr2" style={{ marginTop: 4 }}>
                  <div><label className="flabel">Date of Birth</label><input className="finput" type="date" value={form.dob} onChange={e => set('dob', e.target.value)} /></div>
                  <div><label className="flabel">Email Address</label><input className="finput" type="email" placeholder="ngozi@email.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
                </div>
                <div className="form-row fr2">
                  <div><label className="flabel">Home Address *</label><input className="finput" placeholder="Street, City" value={form.address} onChange={e => set('address', e.target.value)} /></div>
                  <div><label className="flabel">State *</label>
                    <select className="finput" value={form.state} onChange={e => set('state', e.target.value)}>
                      <option value="">Select state…</option>
                      {['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'].map(s => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row fr2">
                  <div><label className="flabel">Language</label>
                    <select className="finput" value={form.language} onChange={e => set('language', e.target.value)}>
                      <option>English</option><option>Yoruba</option><option>Igbo</option><option>Hausa</option>
                    </select>
                  </div>
                  <div><label className="flabel">BVN (optional)</label><input className="finput" placeholder="11-digit BVN" value={form.bvn} onChange={e => set('bvn', e.target.value)} /></div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">Next of Kin</div>
                <div className="form-row fr3">
                  <div><label className="flabel">Full Name *</label><input className="finput" placeholder="Full name" value={form.nokName} onChange={e => set('nokName', e.target.value)} /></div>
                  <div><label className="flabel">Relationship</label>
                    <select className="finput" value={form.nokRelation} onChange={e => set('nokRelation', e.target.value)}>
                      <option>Spouse</option><option>Parent</option><option>Sibling</option><option>Friend</option>
                    </select>
                  </div>
                  <div><label className="flabel">Phone</label><input className="finput" type="tel" inputMode="numeric" maxLength={11} placeholder="080XXXXXXXX" value={form.nokPhone} onKeyDown={blockNonDigit} onChange={e => set('nokPhone', digitsOnly(e.target.value).slice(0, 11))} /></div>
                </div>
              </div>
            </div>
            <div>
              <div className="card">
                <div className="card-title">Enrolment Checklist</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <div style={{ color: 'var(--mu)' }}>☐ Valid government ID verified</div>
                  <div style={{ color: 'var(--mu)' }}>☐ Phone OTP verification — next step</div>
                  <div style={{ color: 'var(--mu)' }}>☐ Address verified</div>
                  <div style={{ color: 'var(--mu)' }}>☐ Next of kin captured (optional)</div>
                  <div style={{ color: 'var(--mu)' }}>☐ Customer agreed to terms</div>
                </div>
                <div className="divider" />
                <div className="alert alert-b">ℹ️ OTP verification will happen on the next step.</div>
              </div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-g" onClick={() => {
              if (!form.firstName || !form.lastName || !form.phone || !form.address || !form.state) {
                setError('Please fill all required fields including State.')
                window.scrollTo({ top: 0, behavior: 'smooth' })
                return
              }
              setError('')
              setOtpSent(false); setOtpCode(''); setOtpError('')
              setStep(2)
            }}>Continue →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="grid g-2-1">
            <div className="card">
              <div className="card-title">Verify Phone Number</div>
              <div style={{ marginBottom: 16 }}>
                <label className="flabel">Phone Number</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="finput" value={form.phone} readOnly style={{ flex: 1, background: '#f5f9f6' }} />
                  {phoneVerified && <span style={{ color: 'var(--g)', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Verified</span>}
                </div>
              </div>
              {!phoneVerified && (
                <div style={{ padding: '14px 16px', background: '#f0faf4', borderRadius: 10, border: '1.5px solid #b6e8c8', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: '#2e7d4f', marginBottom: 10 }}>
                    {otpLoading && !otpSent ? 'Sending OTP…' : `A 6-digit code was sent to `}<strong>{form.phone}</strong>
                  </div>
                  <input
                    className="finput"
                    placeholder="Enter 6-digit code"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{ letterSpacing: 6, fontWeight: 700, fontSize: 20, textAlign: 'center' }}
                    maxLength={6}
                  />
                  {otpError && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--rd)' }}>⚠️ {otpError}</div>}
                  {devCode && <div style={{ marginTop: 8, padding: '6px 10px', background: '#fffbe6', border: '1px dashed #f59e0b', borderRadius: 6, fontSize: 12, color: '#92400e' }}>🛠 Dev — OTP: <strong style={{ letterSpacing: 3 }}>{devCode}</strong></div>}
                  <button
                    className="btn btn-out"
                    style={{ marginTop: 10, fontSize: 12, padding: '5px 12px' }}
                    disabled={otpLoading || otpCooldown > 0}
                    onClick={sendOTP}
                  >
                    {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
                  </button>
                </div>
              )}
              {phoneVerified && (
                <div className="alert alert-g">✅ Phone number verified successfully. You may proceed.</div>
              )}
            </div>
            <div className="card">
              <div className="card-title">Why We Verify</div>
              <div style={{ fontSize: 13, color: 'var(--mu)', lineHeight: 1.8 }}>
                • Confirms the customer owns the phone<br />
                • Required for KYC compliance<br />
                • OTP expires in 10 minutes<br />
                • Check SMS inbox or DND status if not received
              </div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button className="btn btn-out" onClick={() => { setStep(1); setPhoneVerified(false); setOtpSent(false) }}>← Back</button>
            {phoneVerified ? (
              <button className="btn btn-g" onClick={() => setStep(3)}>Continue to Photo →</button>
            ) : (
              <button
                className="btn btn-g"
                disabled={otpLoading || otpCode.length !== 6}
                onClick={async () => {
                  setOtpError('')
                  setOtpLoading(true)
                  const res = await fetch('/api/otp/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: form.phone.replace(/\s/g, ''), code: otpCode }),
                  })
                  const data = await res.json()
                  setOtpLoading(false)
                  if (!res.ok) { setOtpError(data.error); return }
                  setPhoneVerified(true)
                  setOtpSent(false)
                  setStep(3)
                }}
              >
                {otpLoading ? 'Verifying…' : 'Verify & Continue →'}
              </button>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="grid g-2-1">
            <div className="card">
              <div className="card-title">Customer Photo</div>

              <div style={{ background: '#111', borderRadius: 10, height: 240, marginBottom: 14, overflow: 'hidden', position: 'relative' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive && !photoDataUrl ? 'block' : 'none' }}
                />
                {photoDataUrl && (
                  <img src={photoDataUrl} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                {!cameraActive && !photoDataUrl && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'rgba(255,255,255,.5)' }}>
                    <div style={{ fontSize: 48 }}>📷</div>
                    <div style={{ fontSize: 13 }}>Camera preview will appear here</div>
                  </div>
                )}
              </div>

              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />

              {cameraError && <div className="alert alert-rd" style={{ marginBottom: 10 }}>⚠️ {cameraError}</div>}

              <div className="btn-row">
                {photoDataUrl ? (
                  <>
                    <button className="btn btn-out" onClick={retake}>🔄 Retake</button>
                    <span style={{ fontSize: 13, color: 'var(--g)', fontWeight: 600, alignSelf: 'center' }}>✓ Photo captured</span>
                  </>
                ) : cameraActive ? (
                  <>
                    <button className="btn btn-g" onClick={capturePhoto}>📸 Capture</button>
                    <button className="btn btn-out" onClick={stopCamera}>✕ Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-g" onClick={startCamera}>📷 Open Camera</button>
                    <button className="btn btn-out" onClick={() => fileInputRef.current?.click()}>🖼️ Upload from Gallery</button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--mu)' }}>
                {photoDataUrl ? 'Photo saved — ready to continue.' : '⚠️ Photo is mandatory — please capture or upload.'}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Photo Guidelines</div>
              <div style={{ fontSize: 13, color: 'var(--mu)', lineHeight: 1.8 }}>
                • Clear, front-facing photo<br />• Good lighting, no shadows<br />• Face must fill 70% of frame<br />• No sunglasses or head covering<br />• White or plain background preferred
              </div>
              <div className="divider" />
              <div className="alert alert-gd">⚠️ Photo recommended for KYC compliance.</div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button className="btn btn-out" onClick={() => { stopCamera(); setStep(2) }}>← Back</button>
            <button className="btn btn-g" onClick={() => {
              if (!photoDataUrl) { setCameraError('Photo is mandatory. Please capture or upload a photo.'); return }
              stopCamera(); setStep(4)
            }}>Continue to Savings Plan →</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          {form.plans.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-title">Added Plans ({form.plans.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.plans.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--gl)', border: '1px solid var(--br)', borderRadius: 10 }}>
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>{p.goal} · ₦{parseFloat(p.dailyAmount || '0').toLocaleString()}/{p.cadence === 'weekly' ? 'wk' : p.cadence === 'monthly' ? 'mo' : 'day'}</div>
                      <div style={{ fontSize: 12, color: 'var(--mu)' }}>{p.cadence === 'weekly' ? parseInt(p.periodDays)/7 + ' weeks' : p.cadence === 'monthly' ? Math.round(parseInt(p.periodDays)/30) + ' months' : p.periodDays + ' days'} · Target ₦{Math.round((p.cadence === 'weekly' ? parseFloat(p.dailyAmount||'0')/7 : p.cadence === 'monthly' ? parseFloat(p.dailyAmount||'0')/30 : parseFloat(p.dailyAmount||'0')) * parseInt(p.periodDays||'0')).toLocaleString()}</div>
                    </div>
                    <button className="btn btn-out" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setForm(f => ({ ...f, plans: f.plans.filter((_, j) => j !== i) }))}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid g-2-1">
            <div className="card">
              <div className="card-title">{form.plans.length > 0 ? 'Add Another Plan' : 'Savings Plan Setup'}</div>
              <div style={{ marginBottom: 12 }}>
                <label className="flabel">Saving Frequency *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => set('cadence', 'daily')} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${form.cadence === 'daily' ? 'var(--g)' : 'var(--br)'}`, background: form.cadence === 'daily' ? 'var(--gl)' : 'var(--card)', color: form.cadence === 'daily' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>📅 Daily</button>
                  <button onClick={() => set('cadence', 'weekly')} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${form.cadence === 'weekly' ? 'var(--g)' : 'var(--br)'}`, background: form.cadence === 'weekly' ? 'var(--gl)' : 'var(--card)', color: form.cadence === 'weekly' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>📆 Weekly</button>
                  <button onClick={() => set('cadence', 'monthly')} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${form.cadence === 'monthly' ? 'var(--g)' : 'var(--br)'}`, background: form.cadence === 'monthly' ? 'var(--gl)' : 'var(--card)', color: form.cadence === 'monthly' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>🗓️ Monthly</button>
                </div>
              </div>
              <div className="form-row fr2">
                <div><label className="flabel">{form.cadence === 'weekly' ? 'Weekly' : form.cadence === 'monthly' ? 'Monthly' : 'Daily'} Saving Amount (₦) *</label><input className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder={form.cadence === 'weekly' ? '3500' : form.cadence === 'monthly' ? '15000' : '500'} value={form.dailyAmount} onChange={e => set('dailyAmount', nonNegativeString(e.target.value))} /></div>
                <div><label className="flabel">Saving Period {form.cadence === 'weekly' ? '(Weeks)' : form.cadence === 'monthly' ? '(Months)' : '(Days)'} *</label>
                  <select className="finput" value={form.periodDays} onChange={e => set('periodDays', e.target.value)}>
                    <option value="">Select…</option>
                    {form.cadence === 'weekly' ? (
                      <>
                        <option value="28">4 Weeks</option><option value="56">8 Weeks</option>
                        <option value="84">12 Weeks</option><option value="168">24 Weeks</option><option value="364">52 Weeks</option>
                      </>
                    ) : form.cadence === 'monthly' ? (
                      <>
                        <option value="30">1 Month</option><option value="60">2 Months</option>
                        <option value="90">3 Months</option><option value="180">6 Months</option><option value="365">12 Months</option>
                      </>
                    ) : (
                      <>
                        <option value="31">31 Days</option><option value="62">62 Days</option>
                        <option value="93">93 Days</option><option value="186">186 Days</option><option value="365">365 Days</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
              <div className="form-row fr2">
                <div><label className="flabel">Saving Goal *</label>
                  <select className="finput" value={form.goal} onChange={e => set('goal', e.target.value)}>
                    <option value="">Select goal…</option>
                    <option>School Fees</option><option>Business Capital</option><option>House Rent</option>
                    <option>Medical Expenses</option><option>Wedding / Event</option><option>Other</option>
                  </select>
                </div>
                <div><label className="flabel">Start Date</label><input className="finput" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /></div>
              </div>
              <label className="flabel">Notes (optional)</label>
              <input className="finput" placeholder="e.g. For daughter's school fees" value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <div className="card">
              <div className="card-title">Terms &amp; Agreement</div>
              <div style={{ fontSize: 12.5, color: 'var(--mu)', lineHeight: 1.8, marginBottom: 14 }}>
                By creating this account, the customer agrees to:<br /><br />
                • Save the specified daily amount<br />• Comply with the plan duration<br />• Allow deductions on maturity date<br />• Agent is responsible for collection<br />• A platform fee will be deducted at withdrawal
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }} onClick={() => set('agreed', !form.agreed)}>
                <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: `2px solid ${form.agreed ? 'var(--g)' : 'var(--br)'}`, background: form.agreed ? 'var(--g)' : 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                  {form.agreed && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                </div>
                <label style={{ cursor: 'pointer' }}>Customer has verbally agreed to terms</label>
              </div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button className="btn btn-out" onClick={() => setStep(3)}>← Back</button>
            <button
              className="btn btn-out"
              type="button"
              onClick={() => {
                if (!form.dailyAmount || !form.periodDays || !form.goal) { setError('Fill the plan fields to add it.'); return }
                setForm(f => ({
                  ...f,
                  plans: [...f.plans, { dailyAmount: f.dailyAmount, periodDays: f.periodDays, goal: f.goal, startDate: f.startDate || new Date().toISOString().split('T')[0], notes: f.notes, cadence: f.cadence }],
                  dailyAmount: '', periodDays: '', goal: '', startDate: '', notes: '', cadence: 'daily',
                }))
                setError('')
              }}
            >➕ Add Another Plan</button>
            <button className="btn btn-g" onClick={() => {
              const draftHasAny = form.dailyAmount || form.periodDays || form.goal
              const draftValid = form.dailyAmount && form.periodDays && form.goal
              if (draftHasAny && !draftValid) { setError('Complete the plan fields, or clear them to continue.'); return }
              if (!draftValid && form.plans.length === 0) { setError('Add at least one plan.'); return }
              if (draftValid) {
                setForm(f => ({
                  ...f,
                  plans: [...f.plans, { dailyAmount: f.dailyAmount, periodDays: f.periodDays, goal: f.goal, startDate: f.startDate || new Date().toISOString().split('T')[0], notes: f.notes, cadence: f.cadence }],
                  dailyAmount: '', periodDays: '', goal: '', startDate: '', notes: '', cadence: 'daily',
                }))
              }
              setError(''); setStep(5)
            }}>Continue →</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          <div className="grid g-2-1">
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">NFC Card Assignment</div>
                <div className="form-row">
                  <label className="flabel">Card Serial</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="finput" placeholder="e.g. VES-NFC-00841" value={form.nfcCard} onChange={e => set('nfcCard', e.target.value)} style={{ flex: 1 }} />
                    <button type="button" onClick={startQrScan} style={{ padding: '0 16px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 20, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Scan QR Code">📷</button>
                  </div>
                  {qrError && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>⚠️ {qrError}</div>}
                </div>

                {qrScanActive && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📷 Point camera at card QR code</div>
                    <div style={{ position: 'relative', width: '100%', maxWidth: 360, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                      <video ref={qrVideoRef} playsInline muted style={{ width: '100%', display: 'block' }} />
                      {/* Scan frame overlay */}
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ width: 200, height: 200, position: 'relative' }}>
                          {[['0','0'],['0','auto'],['auto','0'],['auto','auto']].map(([t,b], i) => (
                            <div key={i} style={{ position: 'absolute', width: 30, height: 30, top: t === '0' ? 0 : undefined, bottom: b === '0' ? 0 : undefined, left: i < 2 ? 0 : undefined, right: i >= 2 ? 0 : undefined, borderTop: t === '0' ? '3px solid #00e676' : undefined, borderBottom: b === '0' ? '3px solid #00e676' : undefined, borderLeft: i < 2 ? '3px solid #00e676' : undefined, borderRight: i >= 2 ? '3px solid #00e676' : undefined }} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ color: '#aaa', fontSize: 13, marginTop: 12, textAlign: 'center' }}>Scanning automatically…</div>
                    <button onClick={stopQrScan} style={{ marginTop: 20, padding: '12px 32px', background: '#fff', color: '#111', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
                  </div>
                )}
                <div className="form-row">
                  <label className="flabel">Card Type</label>
                  <input className="finput" value="Agent NFC Card (Standard)" readOnly style={{ background: '#f5f9f6' }} />
                </div>
                <div className="alert alert-b" style={{ marginTop: 8 }}>💳 NFC card will be linked to customer account upon activation</div>
              </div>
              <div className="card">
                <div className="card-title">Registration Fee</div>
                <div className="form-row fr2">
                  <div>
                    <label className="flabel">Registration Fee (₦)</label>
                    <input className="finput" type="tel" inputMode="decimal" value={form.registrationFee} readOnly style={{ background: 'var(--surface2)', cursor: 'not-allowed' }} />
                  </div>
                  <div>
                    <label className="flabel">Fee Collection Method</label>
                    <select className="finput" value={form.feeMethod} onChange={e => set('feeMethod', e.target.value)}>
                      <option value="cash">Cash Collected from Customer</option>
                      <option value="wallet">Deduct from Agent Wallet</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 12, padding: '12px 14px', background: '#f0faf4', borderRadius: 10, border: '1.5px solid #b6e8c8', fontSize: 13 }}>
                  <div className="conf-row"><span className="conf-lbl">Registration Fee</span><strong style={{ color: 'var(--g)' }}>₦{parseFloat(form.registrationFee || '0').toLocaleString()}</strong></div>
                  <div className="conf-row" style={{ marginTop: 6 }}><span className="conf-lbl">Collection</span><span className="conf-val">{form.feeMethod === 'wallet' ? 'Deduct from Agent Wallet' : 'Cash Collected from Customer'}</span></div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mu)' }}>Note: Fee will be recorded as a transaction</div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Card &amp; Fee Info</div>
              <div style={{ fontSize: 13, color: 'var(--mu)', lineHeight: 1.8 }}>
                • NFC card serial is optional at enrolment<br />
                • Card can be assigned later from customer profile<br />
                • Registration fee default is ₦500<br />
                • Wallet deduction requires sufficient balance
              </div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button className="btn btn-out" onClick={() => setStep(4)}>← Back</button>
            <button
              className="btn btn-out"
              type="button"
              onClick={() => { setError(''); set('nfcCard', ''); setStep(6) }}
              title="Skip card assignment — link a card later from Configure Card"
            >Skip Card →</button>
            <button className="btn btn-g" onClick={() => { setError(''); setStep(6) }}>Continue →</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div>
          <div className="grid g-2-1">
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Review — Customer Details</div>
                <div className="alert alert-g">✅ All details captured. Review carefully before submitting.</div>
                <div className="conf-table">
                  <div className="conf-row"><span className="conf-lbl">Full Name</span><span className="conf-val">{form.firstName} {form.lastName}</span></div>
                  <div className="conf-row"><span className="conf-lbl">Phone</span><span className="conf-val">{form.phone} ✓ Verified</span></div>
                  <div className="conf-row"><span className="conf-lbl">Address</span><span className="conf-val">{form.address}</span></div>
                  <div className="conf-row"><span className="conf-lbl">Next of Kin</span><span className="conf-val">{form.nokName} ({form.nokRelation})</span></div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">Review — Savings Plans ({form.plans.length})</div>
                {form.plans.map((p, i) => {
                  const amt = parseFloat(p.dailyAmount || '0')
                  const days = parseInt(p.periodDays || '0')
                  const dailyEquiv = p.cadence === 'weekly' ? amt / 7 : p.cadence === 'monthly' ? amt / 30 : amt
                  const totalP = Math.round(dailyEquiv * days)
                  const durationLabel = p.cadence === 'weekly' ? `${days/7} Weeks` : p.cadence === 'monthly' ? `${Math.round(days/30)} Months` : `${days} Days`
                  const mat = p.startDate ? (() => { const d = new Date(p.startDate); d.setDate(d.getDate() + days); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })() : ''
                  return (
                    <div key={i} className="conf-table" style={{ marginBottom: i < form.plans.length - 1 ? 12 : 0, paddingBottom: i < form.plans.length - 1 ? 12 : 0, borderBottom: i < form.plans.length - 1 ? '1px dashed var(--br)' : 'none' }}>
                      <div className="conf-row"><span className="conf-lbl">Plan {i + 1}</span><strong>{p.goal}</strong></div>
                      <div className="conf-row"><span className="conf-lbl">{p.cadence === 'weekly' ? 'Weekly' : p.cadence === 'monthly' ? 'Monthly' : 'Daily'} Amount</span><strong style={{ color: 'var(--g)' }}>₦{amt.toLocaleString()}</strong></div>
                      <div className="conf-row"><span className="conf-lbl">Period</span><span className="conf-val">{durationLabel}</span></div>
                      <div className="conf-row"><span className="conf-lbl">Target Total</span><strong style={{ color: 'var(--g)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 16 }}>₦{totalP.toLocaleString()}</strong></div>
                      <div className="conf-row"><span className="conf-lbl">Maturity Date</span><span className="conf-val">{mat}</span></div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Final Checklist</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, marginBottom: 16 }}>
                <div style={{ color: 'var(--g)' }}>✅ Profile details captured</div>
                <div style={{ color: 'var(--g)' }}>✅ Phone number verified</div>
                {photoDataUrl
                  ? <img src={photoDataUrl} alt="Customer" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', border: '2px solid var(--g)' }} />
                  : <div style={{ color: 'var(--mu)' }}>No photo — will be skipped</div>
                }
                <div style={{ color: 'var(--g)' }}>✅ Savings plan set</div>
                <div style={{ color: form.agreed ? 'var(--g)' : 'var(--rd)' }}>{form.agreed ? '✅' : '❌'} Customer agreed to terms</div>
              </div>
              <div className="alert alert-b">ℹ️ A welcome SMS will be sent to the customer&apos;s phone upon account creation.</div>
            </div>
          </div>
          <div style={{ marginTop: 4, background: 'var(--card)', border: `1.5px solid ${form.agreed ? 'var(--g)' : 'var(--br)'}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }} onClick={() => set('agreed', !form.agreed)}>
              <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1, border: `2px solid ${form.agreed ? 'var(--g)' : 'var(--br)'}`, background: form.agreed ? 'var(--g)' : 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
                {form.agreed && <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                <strong>Customer has agreed to terms &amp; conditions.</strong> They understand the daily savings amount, the fixed period, the maturity date and the withdrawal rules for this plan.
              </div>
            </div>
          </div>
          {error && (
            <div className="alert alert-rd" style={{ marginTop: 12 }}>🔴 {error}</div>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-out" disabled={loading} onClick={() => setStep(5)}>← Edit</button>
            <button
              className="btn btn-g"
              disabled={loading || !form.agreed}
              style={{ opacity: (loading || !form.agreed) ? .55 : 1, cursor: (loading || !form.agreed) ? 'not-allowed' : 'pointer' }}
              onClick={submit}
              title={!form.agreed ? 'Tick the terms box to continue' : ''}
            >
              {loading ? '⏳ Creating…' : '✓ Create Account'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
