'use client'
import DatePicker from '@/components/ui/DatePicker'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import Logo from '@/components/Logo'
import CameraCapture from '@/components/ui/CameraCapture'

const STEPS = ['Personal', 'Photo', 'Verify Email', 'Password']

const STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara']

const LOADER_STEPS = [
  [0, 'Preparing your form…'],
  [18, 'Loading agent portal…'],
  [38, 'Verifying invitation…'],
  [60, 'Setting up your profile…'],
  [80, 'Almost ready…'],
  [96, 'Ready to register!'],
] as [number, string][]

const emptyForm = {
  firstName: '', lastName: '', phone: '', dob: '', gender: '', state: '',
  lga: '', address: '', nin: '', nokName: '', nokPhone: '',
}

export default function AgentOnboardPage() {
  const { token } = useParams<{ token: string }>()
  const [email, setEmail] = useState('')
  const [validating, setValidating] = useState(true)
  const [invalidMsg, setInvalidMsg] = useState('')

  // screens: 'landing' | 'loading' | 'form'
  const [screen, setScreen] = useState<'landing' | 'loading' | 'form'>('landing')
  const [loaderPct, setLoaderPct] = useState(0)
  const [loaderText, setLoaderText] = useState('Preparing your form…')
  const [loaderReady, setLoaderReady] = useState(false)

  const [step, setStep] = useState(1)
  const [form, setForm] = useState(emptyForm)
  const [photo, setPhoto] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<{ agentId: string; name: string } | null>(null)

  useEffect(() => {
    fetch(`/api/agent/onboard/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.email) setEmail(d.email)
        else setInvalidMsg(d.error ?? 'Invalid invite link')
      })
      .catch(() => setInvalidMsg('Network error'))
      .finally(() => setValidating(false))
  }, [token])

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

  const set = (k: keyof typeof emptyForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  function validateStep(): boolean {
    setError('')
    if (step === 1) {
      if (!form.firstName || !form.lastName || !form.phone || !form.state || !form.address || !form.nokName || !form.nokPhone) {
        setError('Please fill all required fields'); return false
      }
      if (!form.dob) { setError('Please pick your date of birth'); return false }
      if (!form.gender) { setError('Please select your gender'); return false }
    }
    if (step === 3 && !emailVerified) {
      setError('Please verify your email before continuing'); return false
    }
    if (step === 4) {
      if (password.length < 6) { setError('Password must be at least 6 characters'); return false }
      if (password !== confirmPassword) { setError('Passwords do not match'); return false }
    }
    return true
  }

  async function sendOtp() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/agent/onboard/${token}/send-otp`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed to send code'); return }
      setOtpSent(true)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  async function verifyOtp() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/agent/onboard/${token}/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otpCode }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Invalid code'); return }
      setEmailVerified(true)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  async function submit() {
    if (!validateStep()) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/agent/onboard/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photoUrl: photo, password }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Submission failed'); return }
      setDone(d)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  if (validating) return (
    <div style={centered}>
      <div style={spinner} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (invalidMsg) return (
    <div style={centered}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🔗</div>
      <div style={{ fontFamily: 'sans-serif', fontSize: 20, fontWeight: 900, color: '#1a1a1a', marginBottom: 8 }}>Invalid Link</div>
      <div style={{ fontSize: 14, color: '#888', textAlign: 'center', maxWidth: 300 }}>{invalidMsg}</div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(155deg,#051810 0%,#0A3520 60%,#0C4824 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 18px' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 22, padding: '30px 20px', textAlign: 'center', maxWidth: 340, width: '100%' }}>
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'linear-gradient(135deg,#0D6B3A,#1DC96A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px', boxShadow: '0 12px 40px rgba(29,201,106,.38)' }}>🎉</div>
        <div style={{ fontSize: 21, fontWeight: 900, color: '#fff', marginBottom: 8, letterSpacing: -.3 }}>Welcome to <span style={{ color: '#1DC96A' }}>Vochus!</span></div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.52)', lineHeight: 1.65, marginBottom: 18 }}>Your application has been submitted. Our team will verify your details within 24–48 hours.</p>
        <div style={{ background: 'rgba(29,201,106,.1)', border: '1px solid rgba(29,201,106,.2)', borderRadius: 10, padding: 12, fontSize: 11, color: 'rgba(255,255,255,.68)', marginBottom: 18 }}>
          Your Agent ID<br /><strong style={{ color: '#1DC96A', fontSize: 15, letterSpacing: 1 }}>{done.agentId}</strong>
        </div>
        {[
          'Application submitted successfully',
          'Team reviews & verifies documents (24–48h)',
          'Receive Agent ID card & portal access',
          'Complete onboarding & start earning',
        ].map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', marginBottom: 7 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(29,201,106,.17)', color: '#1DC96A', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{t}</div>
          </div>
        ))}
      </div>
    </div>
  )

  // ── SCREEN 1: LANDING ──
  if (screen === 'landing') return (
    <div style={{ background: 'linear-gradient(155deg,#051810 0%,#0A3520 50%,#0C4824 100%)', minHeight: '100dvh', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif' }}>
      <style>{`
        @keyframes bdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.5)}}
        @keyframes shimmer{0%{left:-120%}60%,100%{left:160%}}
        .sh-btn{position:relative;overflow:hidden}
        .sh-btn::after{content:'';position:absolute;top:0;left:-120%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);animation:shimmer 2.8s ease-in-out infinite;pointer-events:none}
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 18px 48px', minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
        {/* Rings */}
        <div style={{ position: 'absolute', width: 300, height: 300, top: -60, right: -60, borderRadius: '50%', border: '1px solid rgba(29,201,106,.10)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 190, height: 190, bottom: -45, left: -45, borderRadius: '50%', border: '1px solid rgba(29,201,106,.10)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(29,201,106,.13)', border: '1px solid rgba(29,201,106,.28)', borderRadius: 28, padding: '5px 13px', fontSize: 10, fontWeight: 700, color: '#1DC96A', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 24 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1DC96A', boxShadow: '0 0 5px #1DC96A', animation: 'bdot 1.5s ease-in-out infinite', display: 'inline-block' }} />
            Agent Invitation
          </div>

          {/* Card */}
          <div style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 22, padding: '24px 20px', marginBottom: 20 }}>
            {/* Logo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, marginBottom: 20 }}>
              <Logo size={52} tile />
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>Vochus Easy Save</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 1 }}>Agent Onboarding Programme</div>
              </div>
            </div>

            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>✉️</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#F5B928', letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'center', marginBottom: 6 }}>You&apos;ve been personally invited</div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.2, letterSpacing: -.3, marginBottom: 8 }}>Join the Vochus<br /><span style={{ color: '#1DC96A' }}>Agent Network</span></h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', textAlign: 'center', lineHeight: 1.6, marginBottom: 18 }}>Earn commissions, serve your community, and grow with Nigeria&apos;s fastest-growing savings platform.</p>

            {/* Perks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
              {[
                ['💰', 'Earn Commission Every Cycle', 'Get paid on every customer savings contribution'],
                ['🏆', '3-Tier Reward System', 'Standard → Premium → Elite with growing benefits'],
                ['📱', 'Full Digital Platform', 'Agent portal, enrollment tools & live dashboard'],
                ['📚', 'Free Training & Support', 'Onboarding session, manual & dedicated helpline'],
              ].map(([icon, title, sub]) => (
                <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 9, padding: '9px 11px' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(29,201,106,.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{title}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 1 }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '3px 0 14px' }} />

            {/* Social proof */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex' }}>
                {['#1A8A4A','#0D6B3A','#C8860A'].map((c, i) => (
                  <div key={i} style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid rgba(255,255,255,.12)', background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', marginLeft: i === 0 ? 0 : -7 }}>👤</div>
                ))}
                <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid rgba(255,255,255,.12)', background: '#062516', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', marginLeft: -7 }}>+2k</div>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.48)' }}><strong style={{ color: 'rgba(255,255,255,.75)' }}>2,400+ agents</strong> already earning</div>
            </div>

            {/* CTA */}
            <button className="sh-btn" onClick={startLoader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 15, background: 'linear-gradient(135deg,#0D6B3A,#1DC96A)', color: '#fff', fontSize: 15, fontWeight: 800, border: 'none', borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Click to Register as Agent
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>→</div>
            </button>
          </div>

          {/* Trust bar */}
          <div style={{ width: '100%', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              {['🔒 SSL Secured', '✅ KYC Verified', '🇳🇬 CBN Compliant'].map(t => (
                <span key={t} style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{t}</span>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.24)', lineHeight: 1.7 }}>By registering you agree to our Terms &amp; Privacy Policy.<br />Vochus Financial Services Ltd © 2025</div>
          </div>
        </div>
      </div>
    </div>
  )

  // ── SCREEN 2: LOADER ──
  if (screen === 'loading') return (
    <div style={{ background: 'linear-gradient(155deg,#051810 0%,#0C3A1A 55%,#0A3520 100%)', minHeight: '100dvh', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', position: 'relative', overflow: 'hidden' }}>
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

      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 22px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 320 }}>
          {/* Logo with rings */}
          <div style={{ position: 'relative', width: 76, height: 76, marginBottom: 30, flexShrink: 0 }}>
            <div style={{ position: 'absolute', width: 108, height: 108, top: -16, left: -16, borderRadius: '50%', border: '1px solid rgba(29,201,106,.2)', animation: 'ring 2.6s ease-out infinite' }} />
            <div style={{ position: 'absolute', width: 150, height: 150, top: -37, left: -37, borderRadius: '50%', border: '1px solid rgba(29,201,106,.2)', animation: 'ring 2.6s ease-out infinite', animationDelay: '.8s' }} />
            <Logo size={76} tile style={{ position: 'absolute', inset: 0 }} />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,185,40,.12)', border: '1px solid rgba(245,185,40,.26)', borderRadius: 26, padding: '4px 12px', fontSize: 9, fontWeight: 700, color: '#F5B928', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14 }}>⭐ Welcome, Future Agent</div>

          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1.15, letterSpacing: -.3, marginBottom: 7 }}>
            Ready to start<span style={{ color: '#1DC96A', display: 'block' }}>your journey?</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.48)', lineHeight: 1.65, marginBottom: 16 }}>Join thousands of Vochus agents building income and empowering communities across Nigeria.</p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 26 }}>
            {['⚡ 5 quick steps', '📸 Add your photo', '✓ Quick approval'].map(t => (
              <div key={t} style={{ background: 'rgba(29,201,106,.10)', border: '1px solid rgba(29,201,106,.2)', borderRadius: 16, padding: '4px 9px', fontSize: 9, color: 'rgba(255,255,255,.65)', fontWeight: 500 }}>{t}</div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ width: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, marginBottom: loaderReady ? 0 : 0 }}>
            <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,.10)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${loaderPct}%`, background: 'linear-gradient(90deg,#1DC96A,#F5B928)', borderRadius: 2, transition: 'width .12s linear' }} />
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: '.04em' }}>{loaderText}</div>
          </div>

          {/* Start button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 24, opacity: loaderReady ? 1 : 0, transform: loaderReady ? 'none' : 'translateY(12px)', transition: 'opacity .45s ease,transform .45s ease', pointerEvents: loaderReady ? 'auto' : 'none' }}>
            <button className="go-btn" onClick={() => setScreen('form')} style={{ padding: '14px 40px', background: 'linear-gradient(135deg,#C8860A,#F5B928)', color: '#fff', fontSize: 14, fontWeight: 800, border: 'none', borderRadius: 44, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7 }}>
              ✦ Start Registration →
            </button>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>Your registration form is ready</div>
          </div>
        </div>
      </div>
    </div>
  )

  // ── SCREEN 3: FORM ──
  return (
    <div style={{ minHeight: '100dvh', background: '#f7f8fa', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px 48px' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Logo size={40} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#1a1a1a' }}>Vochus Easy Save</div>
            <div style={{ fontSize: 12, color: '#888' }}>Agent Registration</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#555' }}>Completing registration for <strong>{email}</strong></div>
      </div>

      {/* Step indicator */}
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        {STEPS.map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: i + 1 < step ? '#1a5c35' : i + 1 === step ? '#1a5c35' : '#ddd', color: i + 1 <= step ? '#fff' : '#999' }}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <div style={{ fontSize: 10, color: i + 1 === step ? '#1a5c35' : '#999', fontWeight: i + 1 === step ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</div>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i + 1 < step ? '#1a5c35' : '#ddd', marginBottom: 18, marginLeft: 4, marginRight: 4 }} />}
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        {error && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid rgba(185,28,28,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <>
            <div style={sectionLabel}>Personal Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={lbl}>First Name *</label><input style={inp} placeholder="e.g. Adebayo" value={form.firstName} onChange={e => set('firstName', e.target.value)} /></div>
              <div><label style={lbl}>Last Name *</label><input style={inp} placeholder="e.g. Okafor" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></div>
              <div><label style={lbl}>Phone Number *</label><input style={inp} type="tel" inputMode="numeric" maxLength={11} placeholder="0809 123 4567" value={form.phone} onKeyDown={blockNonDigit} onChange={e => set('phone', digitsOnly(e.target.value).slice(0, 11))} /></div>
              <div><label style={lbl}>Date of Birth *</label><DatePicker ariaLabel="Date of birth" sheetTitle="Pick your date of birth" allowEmpty yearPicker
                emptyViewIso={`${new Date().getFullYear() - 30}-01-01`} maxIso={new Date().toLocaleDateString('en-CA')} value={form.dob} onChange={iso => set('dob', iso)} /></div>
              <div>
                <label style={lbl}>Gender *</label>
                <select style={inp} value={form.gender} onChange={e => set('gender', e.target.value)}>
                  <option value="">Select</option><option>Male</option><option>Female</option>
                </select>
              </div>
              <div>
                <label style={lbl}>State *</label>
                <select style={inp} value={form.state} onChange={e => set('state', e.target.value)}>
                  <option value="">Select State</option>
                  {STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={lbl}>LGA / Area</label><input style={inp} placeholder="e.g. Lagos Mainland" value={form.lga} onChange={e => set('lga', e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Residential Address *</label><input style={inp} placeholder="Street, Area, State" value={form.address} onChange={e => set('address', e.target.value)} /></div>
              <div><label style={lbl}>NIN</label><input style={inp} placeholder="11-digit NIN" maxLength={11} value={form.nin} onChange={e => set('nin', e.target.value)} /></div>
              <div><label style={lbl}>Next of Kin Name *</label><input style={inp} placeholder="Full name" value={form.nokName} onChange={e => set('nokName', e.target.value)} /></div>
              <div><label style={lbl}>Next of Kin Phone *</label><input style={inp} type="tel" inputMode="numeric" maxLength={11} placeholder="Phone number" value={form.nokPhone} onKeyDown={blockNonDigit} onChange={e => set('nokPhone', digitsOnly(e.target.value).slice(0, 11))} /></div>
            </div>
            <div style={btnRow}>
              <button style={btnPrimary} onClick={() => { if (validateStep()) setStep(2) }}>Next: Photo →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={sectionLabel}>Passport Photo</div>
            <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#2e7d4f', marginBottom: 16 }}>
              Take a clear photo of your face with your phone’s camera: plain background, no hat or sunglasses. Photos from your gallery can’t be used.
            </div>
            <div style={{ marginBottom: 16 }}>
              <CameraCapture value={photo} onChange={setPhoto} facing="user" subject="your" />
            </div>
            <div style={{ ...btnRow, justifyContent: 'space-between' }}>
              <button style={btnOutline} onClick={() => setStep(1)}>← Back</button>
              <button style={btnPrimary} onClick={() => setStep(3)}>Next: Verify Email →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={sectionLabel}>Verify Your Email</div>
            <div style={{ background: '#f0faf4', border: '1px solid #b6e8c8', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#2e7d4f', marginBottom: 20 }}>
              We&apos;ll send a 6-digit code to <strong>{email}</strong>
            </div>
            {emailVerified ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a5c35' }}>Email Verified!</div>
              </div>
            ) : (
              <>
                {!otpSent ? (
                  <button style={{ ...btnPrimary, marginBottom: 16 }} onClick={sendOtp} disabled={loading}>
                    {loading ? 'Sending…' : '📧 Send Verification Code'}
                  </button>
                ) : (
                  <>
                    <label style={lbl}>6-Digit Code</label>
                    <input
                      style={{ ...inp, fontSize: 28, fontWeight: 900, textAlign: 'center', fontFamily: 'monospace', letterSpacing: 8, marginBottom: 12 }}
                      type="tel" maxLength={6} placeholder="000000"
                      value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <button style={{ ...btnPrimary, marginBottom: 8 }} onClick={verifyOtp} disabled={loading || otpCode.length !== 6}>
                      {loading ? 'Verifying…' : 'Verify Code'}
                    </button>
                    <button onClick={sendOtp} disabled={loading} style={{ width: '100%', background: 'none', border: 'none', color: '#1a5c35', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 4 }}>Resend code</button>
                  </>
                )}
              </>
            )}
            <div style={{ ...btnRow, justifyContent: 'space-between', marginTop: 16 }}>
              <button style={btnOutline} onClick={() => setStep(2)}>← Back</button>
              <button style={{ ...btnPrimary, opacity: emailVerified ? 1 : .4 }} disabled={!emailVerified} onClick={() => { if (validateStep()) setStep(4) }}>Next: Password →</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div style={sectionLabel}>Set Your Password</div>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 16 }}>
              Choose a strong password. You&apos;ll use it to log into the agent portal.
            </div>
            <label style={lbl}>Password *</label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input style={{ ...inp, paddingRight: 44, marginBottom: 0 }} type={showPass ? 'text' : 'password'} placeholder="Min 6 characters" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
            <label style={lbl}>Confirm Password *</label>
            <input style={inp} type="password" placeholder="Re-enter password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', marginBottom: 10 }}>Registration Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13, color: '#6b7280' }}>
                <div>Name: <strong style={{ color: '#111' }}>{form.firstName} {form.lastName}</strong></div>
                <div>Phone: <strong style={{ color: '#111' }}>{form.phone}</strong></div>
                <div>Email: <strong style={{ color: '#1a5c35' }}>{email} ✓</strong></div>
                <div>State: <strong style={{ color: '#111' }}>{form.state}</strong></div>
                <div>Photo: <strong style={{ color: photo ? '#1a5c35' : '#e67e22' }}>{photo ? 'Taken' : 'Not taken'}</strong></div>
              </div>
            </div>
            <div style={{ ...btnRow, justifyContent: 'space-between' }}>
              <button style={btnOutline} onClick={() => setStep(3)}>← Back</button>
              <button style={{ ...btnPrimary, opacity: loading ? .6 : 1 }} disabled={loading} onClick={submit}>
                {loading ? 'Submitting…' : '🚀 Submit Registration'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const centered: React.CSSProperties = { minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa', padding: 20 }
const spinner: React.CSSProperties = { width: 40, height: 40, border: '3px solid #d1fae5', borderTop: '3px solid #1a5c35', borderRadius: '50%', animation: 'spin 1s linear infinite' }
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#6b7280', marginBottom: 16 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: '#6b7280', marginBottom: 5 }
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', marginBottom: 14, outline: 'none', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { width: '100%', padding: '13px 20px', background: 'linear-gradient(135deg,#2ecc71,#1a5c35)', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, color: '#fff', boxShadow: '0 4px 14px rgba(26,92,53,.3)' }
const btnOutline: React.CSSProperties = { padding: '12px 20px', background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#374151' }
const btnRow: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f3f4f6', gap: 10 }
