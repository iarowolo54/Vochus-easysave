'use client'
import { useState, useRef, useCallback, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { blockMinus, blockNonDigit, digitsOnly, nonNegativeString } from '@/lib/numeric'

const LOADER_STEPS = [
  [0,  'Preparing your form…'],
  [18, 'Loading savings portal…'],
  [38, 'Verifying invitation…'],
  [60, 'Setting up your profile…'],
  [80, 'Almost ready…'],
  [96, 'Ready to register!'],
] as [number, string][]

const PLANS = [
  { days: 31,  name: '31-Day Plan',  desc: 'Short-term · Quick goal' },
  { days: 62,  name: '62-Day Plan',  desc: 'Most popular · Great balance', popular: true },
  { days: 93,  name: '93-Day Plan',  desc: 'Medium-term · Steady growth' },
  { days: 186, name: '186-Day Plan', desc: 'Long-term · Bigger saving' },
  { days: 365, name: '365-Day Plan', desc: 'Full year · Maximum growth' },
]

const STEP_LABELS = ['Personal\nInfo', 'Your\nPhoto', 'Savings\nPlan', 'Review', 'Account\nCreated']
const STEP_TITLES = ['Personal Information', 'Photo Capture (KYC)', 'Choose Savings Plan', 'Review & Confirm', 'Account Active!']

function EnrollContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ref = searchParams.get('ref') ?? ''
  const aid = searchParams.get('aid') ?? ''
  const planParam = searchParams.get('plan')

  const parsedPlan = planParam?.match(/(\d+)x(\d+)d/)
  const initDaily = parsedPlan ? parseInt(parsedPlan[1]) : 500
  const initPeriod = parsedPlan ? parseInt(parsedPlan[2]) : 62

  // screens
  const [screen, setScreen] = useState<'landing' | 'loading' | 'form'>('landing')
  const [loaderPct, setLoaderPct] = useState(0)
  const [loaderText, setLoaderText] = useState('Preparing your form…')
  const [loaderReady, setLoaderReady] = useState(false)

  const [step, setStep] = useState(1)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)

  // Step 1
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [address, setAddress] = useState('')
  const [bvn, setBvn] = useState('')
  const [bvnResult, setBvnResult] = useState<null | { ok: boolean; firstName?: string; lastName?: string; dob?: string | null; error?: string }>(null)
  const [bvnChecking, setBvnChecking] = useState(false)
  const [nokName, setNokName] = useState('')
  const [nokRelation, setNokRelation] = useState('Spouse')
  const [nokPhone, setNokPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  // Step 2
  const [photo, setPhoto] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  // Step 3
  const [daily, setDaily] = useState(initDaily)
  const [period, setPeriod] = useState(initPeriod)
  const [goal, setGoal] = useState('General Savings')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [addedPlans, setAddedPlans] = useState<Array<{ daily: number; period: number; goal: string; cadence: 'daily' | 'weekly' | 'monthly' }>>([])

  // Email OTP
  const [otpScreen, setOtpScreen] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)

  // Step 4/5
  const [terms, setTerms] = useState(false)
  const [result, setResult] = useState<{ customerId: string; name: string; agentName: string; plan: any } | null>(null)

  function startLoader() {
    setScreen('loading')
    setLoaderPct(0)
    setLoaderText('Preparing your form…')
    setLoaderReady(false)
    let i = 0
    const tick = () => {
      if (i >= LOADER_STEPS.length) {
        setLoaderPct(100)
        setLoaderText('✓ Ready to register!')
        setTimeout(() => setLoaderReady(true), 300)
        return
      }
      setLoaderPct(LOADER_STEPS[i][0])
      setLoaderText(LOADER_STEPS[i][1])
      i++
      setTimeout(tick, 580)
    }
    tick()
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    setBvnResult(null)
    if (bvn.length !== 11) return
    const ctrl = new AbortController()
    setBvnChecking(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/identity/bvn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bvn }),
          signal: ctrl.signal,
        })
        const d = await r.json()
        setBvnResult(d.ok ? { ok: true, firstName: d.firstName, lastName: d.lastName, dob: d.dob } : { ok: false, error: d.error ?? 'Could not verify BVN' })
      } catch (e: any) {
        if (e?.name !== 'AbortError') setBvnResult({ ok: false, error: 'Network error verifying BVN' })
      } finally {
        setBvnChecking(false)
      }
    }, 500)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [bvn])

  function maturityDate(days: number) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function validate1() {
    if (!firstName.trim()) { showToast('Enter your first name'); return false }
    if (!phone.trim() || phone.trim().length < 10) { showToast('Enter a valid phone number'); return false }
    if (!email.trim() || !email.includes('@')) { showToast('Enter a valid email address'); return false }
    if (!address.trim()) { showToast('Enter your home address'); return false }
    if (!nokName.trim()) { showToast("Enter next of kin's name"); return false }
    if (!password || password.length < 6) { showToast('Password must be at least 6 characters'); return false }
    if (password !== confirmPassword) { showToast('Passwords do not match'); return false }
    return true
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false })
      streamRef.current = stream
      setCameraOn(true)
      // video element renders after state update — attach stream after DOM settles
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 100)
    } catch { showToast('Camera denied — upload a photo instead') }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraOn(false)
    setCountdown(null)
  }

  function shootCountdown() {
    let c = 3
    setCountdown(c)
    const iv = setInterval(() => {
      c--
      if (c > 0) { setCountdown(c) }
      else {
        clearInterval(iv)
        setCountdown(null)
        capturePhoto()
      }
    }, 1000)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 720
    canvas.height = video.videoHeight || 960
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setPhoto(canvas.toDataURL('image/jpeg', 0.88))
    stopCamera()
    showToast('Photo captured!')
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setPhoto(ev.target?.result as string); showToast('Photo uploaded!') }
    reader.readAsDataURL(file)
  }

  async function createAccount() {
    if (!terms) { showToast('Accept the terms to continue'); return }
    setLoading(true)
    try {
      const first = addedPlans[0] ?? { daily, period, goal, cadence }
      const res = await fetch('/api/customer/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref, aid, firstName, lastName, phone, email, dob, address, gender, bvn,
          nokName, nokRelation, nokPhone, photoUrl: photo, password,
          dailyAmount: first.daily, periodDays: first.period, goal: first.goal, cadence: first.cadence,
          plans: addedPlans.length > 0 ? addedPlans : [{ daily, period, goal, cadence }],
        }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? 'Enrollment failed'); return }
      setResult(data)
      setStep(5)
    } catch { showToast('Network error') }
    finally { setLoading(false) }
  }

  const netPayout = cadence === 'weekly' ? daily * period * 7 : cadence === 'monthly' ? daily * period * 30 : daily * period

  // ── SCREEN 1: LANDING ──
  if (screen === 'landing') return (
    <div style={{ background: 'linear-gradient(155deg,#051810 0%,#0A3520 50%,#0C4824 100%)', minHeight: '100vh', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif' }}>
      <style>{`
        @keyframes bdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.5)}}
        @keyframes coinup{0%{bottom:-28px;opacity:0;transform:rotate(0deg)}10%{opacity:.8}90%{opacity:.8}100%{bottom:105%;opacity:0;transform:rotate(360deg)}}
        @keyframes shimmer{0%{left:-120%}60%,100%{left:160%}}
        .sh-btn{position:relative;overflow:hidden}
        .sh-btn::after{content:'';position:absolute;top:0;left:-120%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);animation:shimmer 2.8s ease-in-out infinite;pointer-events:none}
      `}</style>
      {/* Floating coins */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        {[8, 22, 38, 55, 70, 85].map((left, i) => (
          <div key={i} style={{ position: 'absolute', width: 22, height: 22, bottom: -28, left: `${left}%`, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#FFE566,#C8860A)', border: '2px solid rgba(255,220,60,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#7A4E00', animation: `coinup ${5.5 + i * 0.3}s linear infinite`, animationDelay: `${i * 0.4}s` }}>₦</div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 18px 56px', minHeight: '100vh', position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        {/* Decorative rings */}
        <div style={{ position: 'absolute', width: 300, height: 300, top: -60, right: -60, borderRadius: '50%', border: '1px solid rgba(29,201,106,.10)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 190, height: 190, bottom: -45, left: -45, borderRadius: '50%', border: '1px solid rgba(29,201,106,.10)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(29,201,106,.13)', border: '1px solid rgba(29,201,106,.28)', borderRadius: 28, padding: '5px 14px', fontSize: 10, fontWeight: 700, color: '#1DC96A', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 24 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1DC96A', boxShadow: '0 0 5px #1DC96A', animation: 'bdot 1.5s ease-in-out infinite', display: 'inline-block' }} />
            New Member
          </div>

          <div style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 22, padding: '24px 20px', marginBottom: 20 }}>
            {/* Logo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#0D6B3A,#1DC96A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 900, color: '#fff', boxShadow: '0 8px 32px rgba(29,201,106,.35)' }}>V</div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>Vochus Easy Save</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 1 }}>Self-Enrollment Portal</div>
              </div>
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.2, letterSpacing: -.3, marginBottom: 6 }}>
              Welcome aboard!<br /><span style={{ color: '#F5B928' }}>Your savings journey starts here.</span>
            </h1>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', textAlign: 'center', lineHeight: 1.65, marginBottom: 20 }}>
              You&apos;re just 5 quick steps away from opening your Vochus Easy Save account and taking control of your financial future.
            </p>

            {/* Perks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {[
                ['🌱', 'Start saving today', 'Open your account in minutes and begin your journey'],
                ['🔒', 'Safe & secure', 'Bank-grade security with KYC verification'],
                ['⚡', 'Just 5 steps', 'Simple, fast, and guided enrollment process'],
                ['💰', 'Grow your money', 'Earn interest and collect more than you save'],
              ].map(([icon, title, sub]) => (
                <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(29,201,106,.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{title}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.4)', marginTop: 1 }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0 16px' }} />

            {/* CTA */}
            <button className="sh-btn" onClick={startLoader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 16, background: 'linear-gradient(135deg,#C8860A,#F5B928)', color: '#fff', fontSize: 15, fontWeight: 800, border: 'none', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 18 }}>✦</span> Click to Register
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>→</div>
            </button>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 8 }}>Opens your enrollment form</div>
          </div>

          {/* Trust bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            {['🔒 Secure', '✅ KYC Ready', '🏦 CBN Compliant'].map(t => (
              <span key={t} style={{ fontSize: 10.5, color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>{t}</span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.22)', textAlign: 'center', lineHeight: 1.7 }}>
            By registering you agree to our Terms &amp; Privacy Policy.<br />Vochus Financial Services Ltd © 2025
          </div>
        </div>
      </div>
    </div>
  )

  // ── SCREEN 2: LOADER ──
  if (screen === 'loading') return (
    <div style={{ background: 'linear-gradient(155deg,#051810 0%,#0C3A1A 55%,#0A3520 100%)', minHeight: '100vh', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes coinup{0%{bottom:-28px;opacity:0;transform:rotate(0deg)}10%{opacity:.8}90%{opacity:.8}100%{bottom:105%;opacity:0;transform:rotate(360deg)}}
        @keyframes ring{0%{transform:scale(.5);opacity:.7}100%{transform:scale(1);opacity:0}}
        @keyframes shimmer2{0%{left:-120%}60%,100%{left:160%}}
        .go-btn{position:relative;overflow:hidden}
        .go-btn::after{content:'';position:absolute;top:0;left:-120%;width:55%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);animation:shimmer2 2.4s ease-in-out infinite;pointer-events:none}
      `}</style>
      {/* Floating coins */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        {[7, 21, 37, 54, 69, 84].map((left, i) => (
          <div key={i} style={{ position: 'absolute', width: 20, height: 20, bottom: -28, left: `${left}%`, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#FFE566,#C8860A)', border: '2px solid rgba(255,220,60,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#7A4E00', animation: `coinup ${5.5 + i * 0.3}s linear infinite`, animationDelay: `${i * 0.4}s` }}>₦</div>
        ))}
      </div>

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 22px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 320 }}>
          {/* Logo with rings */}
          <div style={{ position: 'relative', width: 76, height: 76, marginBottom: 30, flexShrink: 0 }}>
            <div style={{ position: 'absolute', width: 108, height: 108, top: -16, left: -16, borderRadius: '50%', border: '1px solid rgba(29,201,106,.2)', animation: 'ring 2.6s ease-out infinite' }} />
            <div style={{ position: 'absolute', width: 150, height: 150, top: -37, left: -37, borderRadius: '50%', border: '1px solid rgba(29,201,106,.2)', animation: 'ring 2.6s ease-out infinite', animationDelay: '.8s' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: 20, background: 'linear-gradient(135deg,#0D6B3A,#1DC96A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 900, color: '#fff', zIndex: 1 }}>V</div>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,185,40,.12)', border: '1px solid rgba(245,185,40,.26)', borderRadius: 26, padding: '4px 12px', fontSize: 9, fontWeight: 700, color: '#F5B928', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>✦ Welcome, Future Saver</div>

          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1.15, letterSpacing: -.3, marginBottom: 7 }}>
            Ready to start<span style={{ color: '#1DC96A', display: 'block' }}>your savings journey?</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.48)', lineHeight: 1.65, marginBottom: 16 }}>Join thousands of Vochus savers building financial freedom across Nigeria.</p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 26 }}>
            {['🌱 Start saving today', '🔒 Safe & secure', '⚡ Just 5 steps'].map(t => (
              <div key={t} style={{ background: 'rgba(29,201,106,.10)', border: '1px solid rgba(29,201,106,.2)', borderRadius: 16, padding: '4px 9px', fontSize: 9.5, color: 'rgba(255,255,255,.65)', fontWeight: 500 }}>{t}</div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ width: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, marginBottom: 0 }}>
            <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,.10)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${loaderPct}%`, background: 'linear-gradient(90deg,#1DC96A,#F5B928)', borderRadius: 2, transition: 'width .12s linear' }} />
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: '.04em' }}>{loaderText}</div>
          </div>

          {/* Trust badges */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16, marginBottom: 0 }}>
            {['🔒 Secure', '✅ KYC Ready', '🏦 CBN Compliant'].map(t => (
              <span key={t} style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 600 }}>{t}</span>
            ))}
          </div>

          {/* Start button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 24, opacity: loaderReady ? 1 : 0, transform: loaderReady ? 'none' : 'translateY(12px)', transition: 'opacity .45s ease,transform .45s ease', pointerEvents: loaderReady ? 'auto' : 'none' }}>
            <button className="go-btn" onClick={() => setScreen('form')} style={{ padding: '14px 40px', background: 'linear-gradient(135deg,#C8860A,#F5B928)', color: '#fff', fontSize: 14, fontWeight: 800, border: 'none', borderRadius: 44, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7 }}>
              ✦ Start Registration →
            </button>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>Your enrollment form is ready</div>
          </div>
        </div>
      </div>
    </div>
  )

  // ── SCREEN 3: FORM ──
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, height: 56, zIndex: 200,
        background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,.3)',
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Plus Jakarta Sans', fontSize: 16, fontWeight: 900, color: '#fff',
        }}>V</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Vochus Easy Save</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Self-Enrollment Portal</div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 100,
          background: 'rgba(46,204,113,.2)', color: '#6edfa0', border: '1px solid rgba(46,204,113,.25)',
        }}>Step {step} of 5</div>
      </div>

      {/* Progress */}
      {step < 5 && (
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{STEP_TITLES[step - 1]}</div>
            <div style={{ fontSize: 12, color: 'var(--mu)', fontWeight: 600 }}>Step {step} of 5</div>
          </div>
          <div style={{ height: 5, background: 'var(--br)', borderRadius: 100, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ height: '100%', width: `${(step / 5) * 100}%`, background: 'linear-gradient(90deg,var(--g),#2ecc71)', borderRadius: 100, transition: 'width .5s ease' }} />
          </div>
          <div style={{ display: 'flex' }}>
            {STEP_LABELS.map((lbl, i) => {
              const n = i + 1
              const done = n < step
              const active = n === step
              return (
                <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}>
                  {n < 5 && <div style={{ position: 'absolute', top: 13, left: '50%', right: '-50%', height: 2, background: done ? 'var(--g)' : 'var(--br)', zIndex: 0 }} />}
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, position: 'relative', zIndex: 1, transition: 'all .3s',
                    background: done ? 'var(--g)' : active ? 'var(--card)' : 'var(--bg)',
                    border: `2px solid ${done ? 'var(--g)' : active ? 'var(--g)' : 'var(--br)'}`,
                    color: done ? '#fff' : active ? 'var(--g)' : 'var(--mu)',
                    boxShadow: active ? '0 0 0 3px rgba(26,107,58,.12)' : 'none',
                  }}>{done ? '✓' : n}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: (done || active) ? 'var(--g)' : 'var(--mu)', textAlign: 'center', lineHeight: 1.2 }}>
                    {lbl.split('\n').map((l, j) => <span key={j}>{l}<br /></span>)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ padding: 16, animation: 'panelIn .3s ease both' }}>
        <style>{`@keyframes panelIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>👋 Tell Us About You</div>
              <div style={{ ...alertStyle, background: 'var(--bl)', color: 'var(--b)', borderColor: 'rgba(26,95,168,.2)', marginBottom: 14 }}>
                Fill in your own details. Everything stays private and secure.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lblStyle}>First Name *</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ngozi" autoComplete="given-name" />
                </div>
                <div>
                  <label style={lblStyle}>Last Name *</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Eze" autoComplete="family-name" />
                </div>
              </div>
              <label style={lblStyle}>Phone Number *</label>
              <input value={phone} onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))} onKeyDown={blockNonDigit} inputMode="numeric" type="tel" maxLength={11} placeholder="080XXXXXXXX" style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }} autoComplete="tel" />
              <label style={lblStyle}>Email Address *</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@email.com" autoComplete="email" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lblStyle}>Date of Birth *</label>
                  <input value={dob} onChange={e => setDob(e.target.value)} type="date" />
                </div>
                <div>
                  <label style={lblStyle}>Gender</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}>
                    <option value="">Select</option>
                    <option>Female</option><option>Male</option><option>Prefer not to say</option>
                  </select>
                </div>
              </div>
              <label style={lblStyle}>Home Address *</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="House No., Street, City, State" />
              <label style={lblStyle}>BVN (optional)</label>
              <input value={bvn} onChange={e => setBvn(digitsOnly(e.target.value).slice(0, 11))} onKeyDown={blockNonDigit} inputMode="numeric" type="tel" maxLength={11} placeholder="11-digit BVN" />
              {bvn.length === 11 && bvnChecking && (
                <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: -8, marginBottom: 8 }}>🔄 Verifying BVN with your bank…</div>
              )}
              {bvnResult && bvnResult.ok && (() => {
                const fullBvnName = `${bvnResult.firstName ?? ''} ${bvnResult.lastName ?? ''}`.trim().toLowerCase()
                const fullFormName = `${firstName} ${lastName}`.trim().toLowerCase()
                const nameMatch = fullBvnName === fullFormName ||
                  (bvnResult.firstName ?? '').toLowerCase() === firstName.toLowerCase() &&
                  (bvnResult.lastName ?? '').toLowerCase() === lastName.toLowerCase()
                return nameMatch ? (
                  <div style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, marginTop: -8, marginBottom: 8 }}>
                    ✅ BVN verified: {bvnResult.firstName} {bvnResult.lastName}
                  </div>
                ) : (
                  <div style={{ background: '#fef3c7', color: '#b45309', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginTop: -8, marginBottom: 8 }}>
                    ⚠️ BVN belongs to <strong>{bvnResult.firstName} {bvnResult.lastName}</strong> — does not match the name you entered above. Update your name to match your BVN, or remove the BVN.
                  </div>
                )
              })()}
              {bvnResult && !bvnResult.ok && (
                <div style={{ background: '#fdecea', color: '#c0392b', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginTop: -8, marginBottom: 8 }}>
                  ⚠️ {bvnResult.error}
                </div>
              )}
              <label style={lblStyle}>Set Password *</label>
              <div style={{ position: 'relative' }}>
                <input value={password} onChange={e => setPassword(e.target.value)} type={showPass ? 'text' : 'password'} placeholder="Min 6 characters" autoComplete="new-password" style={{ paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-72%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>{showPass ? '🙈' : '👁'}</button>
              </div>
              <label style={lblStyle}>Confirm Password *</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  type={showPass ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  style={{
                    paddingRight: 44,
                    borderColor: confirmPassword && confirmPassword !== password ? '#c0392b' : undefined,
                  }}
                />
              </div>
              {confirmPassword && confirmPassword !== password && (
                <div style={{ fontSize: 12, color: '#c0392b', marginTop: -8, marginBottom: 8 }}>⚠️ Passwords do not match</div>
              )}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>👨‍👩‍👧 Next of Kin</div>
              <label style={lblStyle}>Full Name *</label>
              <input value={nokName} onChange={e => setNokName(e.target.value)} placeholder="Full name of next of kin" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lblStyle}>Relationship *</label>
                  <select value={nokRelation} onChange={e => setNokRelation(e.target.value)}>
                    <option>Spouse</option><option>Parent</option><option>Sibling</option><option>Child</option><option>Friend</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>Their Phone *</label>
                  <input value={nokPhone} onChange={e => setNokPhone(digitsOnly(e.target.value).slice(0, 11))} onKeyDown={blockNonDigit} inputMode="numeric" type="tel" maxLength={11} placeholder="080XXXXXXXX" />
                </div>
              </div>
            </div>
            <button style={btnPrimary} onClick={async () => {
              if (!validate1()) return
              if (emailVerified) { setStep(2); return }
              setOtpLoading(true)
              try {
                const res = await fetch('/api/customer/email-otp', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email }),
                })
                if (res.ok) { setOtpScreen(true); showToast('Verification code sent to your email') }
                else { const d = await res.json(); showToast(d.error ?? 'Failed to send code') }
              } finally { setOtpLoading(false) }
            }}>
              {otpLoading ? 'Sending code…' : 'Continue to Photo →'}
            </button>
          </>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>📷 Take Your Photo</div>
              <div style={{ ...alertStyle, background: 'var(--bl)', color: 'var(--b)', borderColor: 'rgba(26,95,168,.2)', marginBottom: 14 }}>
                Photo required for identity verification (KYC). Take a clear selfie.
              </div>
              <div style={{
                width: '100%', aspectRatio: '3/4', maxHeight: 360, background: '#111',
                borderRadius: 14, overflow: 'hidden', position: 'relative', marginBottom: 14,
                border: `2.5px solid ${cameraOn ? 'var(--g)' : 'var(--br)'}`,
              }}>
                {!cameraOn && !photo && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'rgba(255,255,255,.5)' }}>
                    <div style={{ fontSize: 52 }}>📷</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Camera not started</div>
                    <div style={{ fontSize: 12, opacity: .7, textAlign: 'center', padding: '0 20px' }}>Tap "Open Camera" to take your photo</div>
                  </div>
                )}
                {cameraOn && (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <div style={{ width: '65%', maxWidth: 200, aspectRatio: '3/4', border: '3px dashed rgba(46,204,113,.7)', borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(0,0,0,.3)' }} />
                    </div>
                    {countdown !== null && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}>
                        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 96, fontWeight: 900, color: '#fff' }}>{countdown}</div>
                      </div>
                    )}
                  </>
                )}
                {photo && !cameraOn && (
                  <img src={photo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="captured" />
                )}
              </div>
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {!cameraOn && !photo && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ flex: 1, padding: 13, background: 'var(--g)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={startCamera}>
                    📷 Open Camera
                  </button>
                  <label style={{ flex: 1, padding: 13, background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    🖼️ Upload
                    <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>
              )}
              {cameraOn && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <button onClick={shootCountdown} style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff', border: '4px solid var(--g)', cursor: 'pointer', fontSize: 22, boxShadow: '0 2px 10px rgba(0,0,0,.2)' }}>📸</button>
                  <div style={{ fontSize: 12.5, color: 'var(--mu)', textAlign: 'center' }}>Tap to take photo · 3-second countdown</div>
                  <button style={{ ...btnSecondary, width: 'auto', padding: '8px 20px', fontSize: 13, marginBottom: 0 }} onClick={stopCamera}>Cancel</button>
                </div>
              )}
              {photo && !cameraOn && (
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <div style={{ flex: 1, padding: '8px 14px', background: 'var(--gl)', color: 'var(--g)', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>✅ Photo captured</div>
                  <button style={{ padding: '8px 14px', background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 10, cursor: 'pointer', fontSize: 13 }} onClick={() => setPhoto(null)}>Retake</button>
                </div>
              )}
            </div>
            <button style={{ ...btnPrimary, opacity: photo ? 1 : .45 }} disabled={!photo} onClick={() => setStep(3)}>Continue to Savings Plan →</button>
            <button style={btnSecondary} onClick={() => setStep(1)}>← Back</button>
          </>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>💰 How Much Can You Save {cadence === 'weekly' ? 'Weekly' : cadence === 'monthly' ? 'Monthly' : 'Daily'}?</div>
              <input type="tel" inputMode="decimal" value={cadence === 'weekly' ? Math.round(daily * 7) : cadence === 'monthly' ? Math.round(daily * 30) : Math.round(daily)} onKeyDown={blockMinus} onChange={e => { const v = nonNegativeString(e.target.value); const n = Number(v) || 0; setDaily(Math.max(0, cadence === 'weekly' ? n / 7 : cadence === 'monthly' ? n / 30 : n)) }} style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', fontFamily: 'Plus Jakarta Sans', padding: 16 }} />
              <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--mu)', marginTop: -6, marginBottom: 8 }}>Naira per {cadence === 'weekly' ? 'week' : cadence === 'monthly' ? 'month' : 'day'}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => { if (cadence === 'weekly') setPeriod(Math.round(period * 7)); else if (cadence === 'monthly') setPeriod(Math.round(period * 30)); setCadence('daily') }} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${cadence === 'daily' ? 'var(--g)' : 'var(--br)'}`, background: cadence === 'daily' ? 'var(--gl)' : 'var(--card)', color: cadence === 'daily' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>📅 Daily</button>
                <button onClick={() => { if (cadence === 'daily') setPeriod(Math.round(period / 7)); else if (cadence === 'monthly') setPeriod(Math.round(period * 30 / 7)); setCadence('weekly') }} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${cadence === 'weekly' ? 'var(--g)' : 'var(--br)'}`, background: cadence === 'weekly' ? 'var(--gl)' : 'var(--card)', color: cadence === 'weekly' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>📆 Weekly</button>
                <button onClick={() => { if (cadence === 'daily') setPeriod(Math.round(period / 30)); else if (cadence === 'weekly') setPeriod(Math.round(period * 7 / 30)); setCadence('monthly') }} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${cadence === 'monthly' ? 'var(--g)' : 'var(--br)'}`, background: cadence === 'monthly' ? 'var(--gl)' : 'var(--card)', color: cadence === 'monthly' ? 'var(--g)' : 'var(--txt)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>🗓️ Monthly</button>
              </div>
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>📅 Choose Your Plan Duration</div>
              {PLANS.map(p => {
                const isWeekly = cadence === 'weekly'
                const isMonthly = cadence === 'monthly'
                const weeks = Math.round(p.days / 7)
                const months = Math.round(p.days / 30)
                const periodValue = isWeekly ? weeks : isMonthly ? months : p.days
                const displayName = isWeekly ? `${weeks}-Week Plan` : isMonthly ? `${months}-Month Plan` : p.name
                const collectAmount = isWeekly ? (daily * weeks * 7) : isMonthly ? (daily * months * 30) : (daily * p.days)
                return (
                  <div key={p.days} onClick={() => setPeriod(periodValue)} style={{
                    border: `2px solid ${periodValue === period ? 'var(--g)' : 'var(--br)'}`,
                    borderRadius: 13, padding: '14px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10,
                    background: periodValue === period ? 'var(--gl)' : 'var(--card)',
                  }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${periodValue === period ? 'var(--g)' : 'var(--br)'}`, background: periodValue === period ? 'var(--g)' : 'var(--card)', position: 'relative', flexShrink: 0 }}>
                      {periodValue === period && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{displayName}{p.popular ? ' ⭐' : ''}</div>
                      <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 2 }}>{p.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 900, color: 'var(--g)' }}>₦{Math.round(collectAmount).toLocaleString()}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--mu)' }}>you collect</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>You Will Collect</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 40, fontWeight: 900, color: '#fff' }}>₦{Math.round(netPayout).toLocaleString()}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 5 }}>₦{(cadence === 'weekly' ? daily * 7 : cadence === 'monthly' ? daily * 30 : daily).toLocaleString()} × {period} {cadence === 'weekly' ? 'weeks' : cadence === 'monthly' ? 'months' : 'days'} · Matures {maturityDate(period * (cadence === 'weekly' ? 7 : cadence === 'monthly' ? 30 : 1))}</div>
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>🎯 What Are You Saving For?</div>
              <select value={goal} onChange={e => setGoal(e.target.value)}>
                <option>School Fees</option><option>Business Capital</option>
                <option>House Rent / Building</option><option>Medical Expenses</option>
                <option>Wedding / Event</option><option>Farm / Agriculture</option>
                <option>General Savings</option>
              </select>
            </div>
            {addedPlans.length > 0 && (
              <div style={cardStyle}>
                <div style={cardTitleStyle}>✅ Plans Added ({addedPlans.length})</div>
                {addedPlans.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--gl)', border: '1px solid var(--br)', borderRadius: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>{p.goal} · ₦{(p.cadence === 'weekly' ? p.daily * 7 : p.cadence === 'monthly' ? p.daily * 30 : p.daily).toLocaleString()}/{p.cadence === 'weekly' ? 'wk' : p.cadence === 'monthly' ? 'mo' : 'day'}</div>
                      <div style={{ fontSize: 12, color: 'var(--mu)' }}>{p.period} {p.cadence === 'weekly' ? 'weeks' : p.cadence === 'monthly' ? 'months' : 'days'}</div>
                    </div>
                    <button style={{ padding: '4px 10px', fontSize: 12, background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 8, cursor: 'pointer' }} onClick={() => setAddedPlans(a => a.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button
              style={{ ...btnSecondary, background: 'var(--gl)', borderColor: 'var(--g)', color: 'var(--g)', fontWeight: 700 }}
              onClick={() => {
                setAddedPlans(a => [...a, { daily, period, goal, cadence }])
                setDaily(500); setPeriod(62); setGoal('General Savings'); setCadence('daily' as const)
                showToast('Plan added — set up another below')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >➕ Add Another Plan</button>
            <button style={btnPrimary} onClick={() => { setAddedPlans(a => [...a, { daily, period, goal, cadence }]); setStep(4) }}>Review & Confirm →</button>
            <button style={btnSecondary} onClick={() => setStep(2)}>← Back</button>
          </>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>✅ Review Your Details</div>
              <div style={{ ...alertStyle, background: 'var(--gl)', color: 'var(--g)', borderColor: 'rgba(26,107,58,.2)', marginBottom: 14 }}>
                Check carefully before creating your account.
              </div>
              {photo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--br)', marginBottom: 10 }}>
                  <img src={photo} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2.5px solid var(--g)', flexShrink: 0 }} alt="" />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{firstName} {lastName}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--g)', marginTop: 2, fontWeight: 600 }}>✅ Photo captured</div>
                  </div>
                </div>
              )}
              {[['Phone', phone], ['Email', email], ['Date of Birth', dob || '—'], ['Address', address], ['Next of Kin', `${nokName} (${nokRelation})`]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--br)', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--mu)' }}>{l}</span>
                  <span style={{ fontWeight: 700, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle, background: 'var(--gl)', borderColor: 'var(--gm)' }}>
              <div style={{ ...cardTitleStyle, color: 'var(--g)' }}>💰 Savings Plans ({addedPlans.length})</div>
              {addedPlans.map((p, idx) => {
                const rows: Array<[string, string]> = [
                  ['Plan #', String(idx + 1)],
                  [p.cadence === 'weekly' ? 'Weekly Saving' : p.cadence === 'monthly' ? 'Monthly Saving' : 'Daily Saving', p.cadence === 'weekly' ? `₦${Math.round(p.daily * 7).toLocaleString()}/week` : p.cadence === 'monthly' ? `₦${Math.round(p.daily * 30).toLocaleString()}/month` : `₦${p.daily.toLocaleString()}/day`],
                  ['Duration', `${p.period} ${p.cadence === 'weekly' ? 'Weeks' : p.cadence === 'monthly' ? 'Months' : 'Days'}`],
                  ['Goal', p.goal],
                  ['Maturity Date', maturityDate(p.cadence === 'weekly' ? p.period * 7 : p.cadence === 'monthly' ? p.period * 30 : p.period)],
                ]
                return (
                  <div key={idx} style={{ paddingBottom: idx < addedPlans.length - 1 ? 10 : 0, marginBottom: idx < addedPlans.length - 1 ? 10 : 0, borderBottom: idx < addedPlans.length - 1 ? '1px dashed var(--gm)' : 'none' }}>
                    {rows.map(([l, v], i) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5 }}>
                        <span style={{ color: 'var(--mu)' }}>{l}</span>
                        <strong style={{ color: 'var(--g)', textAlign: 'right', maxWidth: '60%' }}>{v}</strong>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <div style={cardStyle}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setTerms(t => !t)}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                  border: `2px solid ${terms ? 'var(--g)' : 'var(--br)'}`,
                  background: terms ? 'var(--g)' : 'var(--card)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .2s',
                }}>
                  {terms && <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: 'var(--txt)', lineHeight: 1.5 }}>
                  I agree to the Vochus Easy Save Terms & Conditions.
                </span>
              </div>
            </div>
            <button style={{ ...btnPrimary, opacity: terms ? 1 : .45 }} disabled={!terms || loading} onClick={createAccount}>
              {loading ? 'Creating Account…' : '🎉 Create My Account & Start Saving'}
            </button>
            <button style={btnSecondary} onClick={() => setStep(3)}>← Edit Plan</button>
          </>
        )}

        {/* ── Step 5 ── */}
        {step === 5 && result && (
          <>
            <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 18, padding: 22, textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 56, marginBottom: 10 }}>🎊</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 5 }}>Welcome, {result.name.split(' ')[0]}!</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>Your Vochus Easy Save account is now active</div>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: '#6edfa0', letterSpacing: 2, marginTop: 10 }}>{result.customerId}</div>
            </div>
            <div style={{ ...alertStyle, background: 'var(--gdl)', color: 'var(--gd)', borderColor: 'rgba(200,132,26,.2)', marginBottom: 14 }}>
              ⚡ <strong>Action needed:</strong> Make your {cadence === 'weekly' ? 'weekly' : cadence === 'monthly' ? 'monthly' : 'daily'} savings of <strong>₦{(cadence === 'weekly' ? daily * 7 : cadence === 'monthly' ? daily * 30 : daily).toLocaleString()}</strong> using Paystack.
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>📊 Your Plan</div>
              {[
                [cadence === 'weekly' ? 'Weekly Amount' : cadence === 'monthly' ? 'Monthly Amount' : 'Daily Amount', `₦${(cadence === 'weekly' ? daily * 7 : cadence === 'monthly' ? daily * 30 : daily).toLocaleString()}`],
                ['Duration', `${period} ${cadence === 'weekly' ? 'Weeks' : cadence === 'monthly' ? 'Months' : 'Days'}`],
                ['Total Contributions', `₦${(daily * (cadence === 'weekly' ? period * 7 : cadence === 'monthly' ? period * 30 : period)).toLocaleString()}`],
                ['You Collect', `₦${Math.round(netPayout).toLocaleString()}`],
                ['Maturity', maturityDate(cadence === 'weekly' ? period * 7 : cadence === 'monthly' ? period * 30 : period)],
                ['Agent', result.agentName],
              ].map(([l, v], i, arr) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--br)' : 'none', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--mu)' }}>{l}</span>
                  <strong style={{ color: 'var(--txt)', textAlign: 'right' }}>{v}</strong>
                </div>
              ))}
            </div>
            <button style={btnPrimary} onClick={() => router.push('/customer/dashboard')}>Go to My Dashboard →</button>
            <button style={btnSecondary} onClick={() => router.push('/customer/save')}>💳 Make First Payment</button>
          </>
        )}
      </div>

      {/* Email OTP overlay */}
      {otpScreen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'var(--bg)', borderRadius: '20px 20px 0 0', padding: 24, animation: 'panelIn .3s ease' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📧</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 900, marginBottom: 4 }}>Verify Your Email</div>
              <div style={{ fontSize: 13, color: 'var(--mu)' }}>
                Enter the 6-digit code sent to <strong>{email}</strong>
              </div>
            </div>
            <input
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="tel" placeholder="000000" maxLength={6}
              style={{ fontSize: 32, fontWeight: 900, textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace', marginBottom: 16 }}
            />
            <button style={btnPrimary} disabled={otpCode.length !== 6 || otpLoading} onClick={async () => {
              setOtpLoading(true)
              try {
                const res = await fetch('/api/customer/email-otp/verify', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, code: otpCode }),
                })
                const d = await res.json()
                if (d.verified) {
                  setEmailVerified(true)
                  setOtpScreen(false)
                  setOtpCode('')
                  setStep(2)
                } else {
                  showToast(d.error ?? 'Invalid code')
                }
              } finally { setOtpLoading(false) }
            }}>
              {otpLoading ? 'Verifying…' : 'Verify & Continue →'}
            </button>
            <button style={{ ...btnSecondary, marginBottom: 0 }} onClick={async () => {
              setOtpLoading(true)
              try {
                await fetch('/api/customer/email-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
                showToast('New code sent')
              } finally { setOtpLoading(false) }
            }}>Resend code</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16,
          background: '#111', color: '#fff', padding: '12px 18px',
          borderRadius: 14, fontSize: 13.5, fontWeight: 600, textAlign: 'center', zIndex: 999,
          animation: 'panelIn .3s ease',
        }}>{toast}</div>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14,
  padding: 16, marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,.05)',
}
const cardTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 800, marginBottom: 14 }
const lblStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }
const alertStyle: React.CSSProperties = { borderRadius: 10, padding: '11px 14px', fontSize: 13, lineHeight: 1.5, border: '1px solid' }
const btnPrimary: React.CSSProperties = {
  width: '100%', padding: 15,
  background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
  border: 'none', borderRadius: 13, cursor: 'pointer',
  fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
  boxShadow: '0 6px 20px rgba(26,107,58,.35)', marginBottom: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const btnSecondary: React.CSSProperties = {
  width: '100%', padding: 13, background: 'var(--card)', border: '1.5px solid var(--br)',
  borderRadius: 13, cursor: 'pointer', fontSize: 14, color: 'var(--txt)', fontWeight: 600, marginBottom: 10,
}

export default function EnrollPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#666' }}>Loading…</div>}>
      <EnrollContent />
    </Suspense>
  )
}
