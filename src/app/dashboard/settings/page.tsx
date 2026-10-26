'use client'

import { useState, useEffect } from 'react'

interface Agent { id: string; agentId: string; name: string; phone: string; location: string; walletBalance: number; createdAt: string; profileUnlocked: boolean; hasPin: boolean; photoUrl?: string | null }

export default function SettingsPage() {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  // PIN state
  const [pinForm, setPinForm] = useState({ pin: '', confirmPin: '', password: '' })
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState('')

  // Bank state
  const [bank, setBank] = useState<{ bankCode?: string; bankName?: string; accountNumber?: string; accountName?: string } | null>(null)
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
  const [bankForm, setBankForm] = useState({ bankCode: '', bankName: '', accountNumber: '' })
  const [resolvedName, setResolvedName] = useState('')
  const [bankSaving, setBankSaving] = useState(false)
  const [bankError, setBankError] = useState('')

  useEffect(() => {
    fetch('/api/agent/bank').then(r => r.json()).then(d => {
      if (d.bank) {
        setBank(d.bank)
        setBankForm({ bankCode: d.bank.bankCode ?? '', bankName: d.bank.bankName ?? '', accountNumber: d.bank.accountNumber ?? '' })
        setResolvedName(d.bank.accountName ?? '')
      }
    }).catch(() => {})
    fetch('/api/paystack/banks').then(r => r.json()).then(d => setBanks(d.banks ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    setResolvedName('')
    setBankError('')
    if (!/^\d{10}$/.test(bankForm.accountNumber) || !bankForm.bankCode) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/paystack/resolve-account?accountNumber=${bankForm.accountNumber}&bankCode=${bankForm.bankCode}`)
      const d = await res.json()
      if (res.ok && d.accountName) setResolvedName(d.accountName)
      else setBankError(d.error ?? 'Could not verify account')
    }, 400)
    return () => clearTimeout(t)
  }, [bankForm.accountNumber, bankForm.bankCode])

  async function saveBank() {
    if (!bankForm.bankCode || !/^\d{10}$/.test(bankForm.accountNumber)) { setBankError('Pick a bank and enter a 10-digit account number'); return }
    if (!resolvedName && !confirm('Could not verify this account with the bank. Save it anyway?')) return
    setBankSaving(true); setBankError('')
    try {
      const res = await fetch('/api/agent/bank', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bankForm),
      })
      const text = await res.text()
      const d = text ? JSON.parse(text) : {}
      if (!res.ok) { setBankError(d.error ?? `Failed (${res.status})`); return }
      setBank(d.bank)
      setToast('Payout bank account saved')
      setTimeout(() => setToast(''), 4000)
    } catch (e: any) {
      setBankError(e.message ?? 'Network error')
    } finally {
      setBankSaving(false)
    }
  }

  useEffect(() => {
    fetch('/api/agent').then(r => r.json()).then(d => {
      setAgent(d.agent)
      setName(d.agent?.name ?? '')
      setPhone(d.agent?.phone ?? '')
      setLocation(d.agent?.location ?? '')
      setLoading(false)
    })
  }, [])

  async function savePin() {
    setPinError('')
    if (!/^\d{4,6}$/.test(pinForm.pin)) { setPinError('PIN must be 4–6 digits'); return }
    if (pinForm.pin !== pinForm.confirmPin) { setPinError('PINs do not match'); return }
    if (!pinForm.password) { setPinError('Enter your account password to confirm'); return }
    setPinLoading(true)
    const res = await fetch('/api/agent/transaction-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinForm.pin, currentPassword: pinForm.password }),
    })
    const data = await res.json()
    setPinLoading(false)
    if (!res.ok) { setPinError(data.error ?? 'Failed'); return }
    setAgent(a => a ? { ...a, hasPin: true } : a)
    setPinForm({ pin: '', confirmPin: '', password: '' })
    setToast('Transaction PIN set successfully')
    setTimeout(() => setToast(''), 4000)
  }

  async function save() {
    setSaving(true); setError('')
    const res = await fetch('/api/agent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, location }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    setAgent(data.agent)
    setToast('Profile updated successfully')
    setSaving(false)
    setTimeout(() => setToast(''), 4000)
  }

  const initials = agent ? agent.name.split(' ').map(w => w[0]).join('').slice(0, 2) : '—'

  return (
    <>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Manage your account and preferences</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 24 }}>Loading…</div>}

      {!loading && agent && (
        <div className="grid g-2-1">
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div className="card-title" style={{ margin: 0 }}>Profile</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: agent.profileUnlocked ? '#dcfce7' : '#f1f5f9', color: agent.profileUnlocked ? '#16a34a' : '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {agent.profileUnlocked ? '🔓 Unlocked' : '🔒 Locked by Admin'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                  {agent.photoUrl
                    ? <img src={agent.photoUrl} alt={agent.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : initials}
                </div>
                <div>
                  <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 17, fontWeight: 700 }}>{agent.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>{agent.agentId} · {agent.location}</div>
                </div>
              </div>
              {!agent.profileUnlocked ? (
                <div style={{ background: '#f8fafc', border: '1px solid var(--bdr)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[{ label: 'Full Name', value: agent.name }, { label: 'Phone', value: agent.phone }, { label: 'Location', value: agent.location }].map(f => (
                      <div key={f.label}>
                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--mu)', marginBottom: 3 }}>{f.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14, fontSize: 12, color: 'var(--mu)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🔒 Profile editing is locked. Contact your administrator to make changes.
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-row fr2">
                    <div><label className="flabel">Full Name</label><input className="finput" value={name} onChange={e => setName(e.target.value)} /></div>
                    <div><label className="flabel">Phone</label><input className="finput" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                  </div>
                  <div className="form-row">
                    <div><label className="flabel">Location</label><input className="finput" value={location} onChange={e => setLocation(e.target.value)} /></div>
                  </div>
                  <button className="btn btn-g btn-sm" disabled={saving} onClick={save}>
                    {saving ? '⏳ Saving…' : 'Save Changes'}
                  </button>
                </>
              )}
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Security</div>
              <div className="form-row">
                <div><label className="flabel">Current Password</label><input className="finput" type="password" placeholder="••••••••" /></div>
              </div>
              <div className="form-row fr2">
                <div><label className="flabel">New Password</label><input className="finput" type="password" placeholder="Min 8 characters" /></div>
                <div><label className="flabel">Confirm New Password</label><input className="finput" type="password" placeholder="Repeat new password" /></div>
              </div>
              <button className="btn btn-out btn-sm">Update Password</button>
            </div>

            {(() => {
              const verified = !!bank?.accountName
              const saved = !!bank?.accountNumber
              const status = verified ? { color: '#16a34a', bg: '#dcfce7', label: '✓ Linked', border: 'var(--g)' }
                : saved ? { color: '#1a5fa8', bg: '#e8f0fb', label: '✓ Saved (unverified)', border: '#1a5fa8' }
                : { color: '#e67e22', bg: '#fff3e0', label: '⚠ Not Linked', border: '#e67e22' }
              return (
            <div className="card" style={{ marginBottom: 16, border: `1.5px solid ${status.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="card-title" style={{ margin: 0 }}>🏦 Payout Bank Account</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: status.bg, color: status.color }}>
                  {status.label}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--mu)', marginBottom: 12 }}>
                {verified
                  ? `Commission payouts will be sent to ${bank!.accountName} · ${bank!.bankName} · ${bank!.accountNumber}. You can update it any time.`
                  : saved
                  ? `Saved: ${bank!.bankName} · ${bank!.accountNumber}. The name couldn't be verified with Paystack — re-save once to retry verification.`
                  : 'Add the bank account where you want your commission payouts deposited. Verified via your bank.'}
              </div>
              {bankError && <div className="alert alert-rd" style={{ marginBottom: 12 }}>🔴 {bankError}</div>}
              <div className="form-row fr2">
                <div>
                  <label className="flabel">Bank</label>
                  <select
                    className="finput"
                    value={bankForm.bankCode}
                    onChange={e => {
                      const b = banks.find(x => x.code === e.target.value)
                      setBankForm(f => ({ ...f, bankCode: e.target.value, bankName: b?.name ?? '' }))
                    }}
                  >
                    <option value="">Select bank…</option>
                    {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flabel">Account Number</label>
                  <input
                    className="finput"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit account number"
                    value={bankForm.accountNumber}
                    onChange={e => setBankForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
              </div>
              {resolvedName && (
                <div style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                  ✓ {resolvedName}
                </div>
              )}
              <button
                className="btn btn-g btn-sm"
                disabled={bankSaving || !bankForm.bankCode || !/^\d{10}$/.test(bankForm.accountNumber)}
                onClick={saveBank}
              >
                {bankSaving ? '⏳ Saving…' : bank?.accountNumber ? 'Update Bank Account' : 'Save Bank Account'}
              </button>
            </div>
              )
            })()}

            <div className="card" style={{ border: agent?.hasPin ? '1.5px solid var(--g)' : '1.5px solid #e67e22' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="card-title" style={{ margin: 0 }}>🔐 Transaction PIN</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: agent?.hasPin ? '#dcfce7' : '#fff3e0', color: agent?.hasPin ? '#16a34a' : '#e67e22' }}>
                  {agent?.hasPin ? '✓ PIN Set' : '⚠ Not Set'}
                </span>
              </div>
              {!agent?.hasPin && (
                <div className="alert" style={{ background: '#fff3e0', color: '#c0392b', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                  ⚠️ You must set a transaction PIN before recording savings or other transactions.
                </div>
              )}
              <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14 }}>
                {agent?.hasPin ? 'Update your 4–6 digit PIN used to confirm transactions.' : 'Set a 4–6 digit PIN that will be required for every transaction.'}
              </p>
              <div className="form-row fr2">
                <div><label className="flabel">{agent?.hasPin ? 'New PIN' : 'PIN'} (4–6 digits)</label><input className="finput" type="password" inputMode="numeric" maxLength={6} placeholder="e.g. 1234" value={pinForm.pin} onChange={e => setPinForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} /></div>
                <div><label className="flabel">Confirm PIN</label><input className="finput" type="password" inputMode="numeric" maxLength={6} placeholder="Repeat PIN" value={pinForm.confirmPin} onChange={e => setPinForm(f => ({ ...f, confirmPin: e.target.value.replace(/\D/g, '') }))} /></div>
              </div>
              <div className="form-row">
                <label className="flabel">Account Password (to confirm)</label>
                <input className="finput" type="password" placeholder="Your login password" value={pinForm.password} onChange={e => setPinForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              {pinError && <div className="alert alert-rd" style={{ marginBottom: 12, fontSize: 13 }}>{pinError}</div>}
              <button className="btn btn-g btn-sm" disabled={pinLoading} onClick={savePin}>
                {pinLoading ? '⏳ Saving…' : agent?.hasPin ? 'Update PIN' : 'Set Transaction PIN'}
              </button>
            </div>
          </div>
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Notifications</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Email Alerts', desc: 'Transactions & approvals', on: true },
                  { label: 'SMS Alerts', desc: 'Critical activity only', on: true },
                  { label: 'Daily Reports', desc: 'End-of-day summary', on: false },
                ].map(n => (
                  <div key={n.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--mu)' }}>{n.desc}</div>
                    </div>
                    <div style={{ width: 44, height: 26, borderRadius: 100, background: n.on ? 'var(--g)' : 'var(--br)', position: 'relative', cursor: 'pointer' }}>
                      <div style={{ position: 'absolute', width: 20, height: 20, borderRadius: '50%', background: '#fff', top: 3, [n.on ? 'right' : 'left']: 3, boxShadow: '0 1px 4px rgba(0,0,0,.15)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Account Info</div>
              <div className="conf-table">
                <div className="conf-row"><span className="conf-lbl">Agent ID</span><strong style={{ color: 'var(--b)' }}>{agent.agentId}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Status</span><span className="bdg bdg-ok">Active</span></div>
                <div className="conf-row"><span className="conf-lbl">Joined</span><span className="conf-val">{new Date(agent.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="conf-row"><span className="conf-lbl">Wallet Balance</span><strong style={{ color: 'var(--g)' }}>₦{agent.walletBalance.toLocaleString()}</strong></div>
              </div>
            </div>
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">📱 Mobile App</div>
              <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 16 }}>
                Get the native Vochus Easy Save Agent app for a faster, offline-capable experience with Bluetooth receipt printing.
              </p>
              <a
                href="/downloads/easysave-agent.apk"
                download
                className="btn btn-g"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', padding: '12px 0', borderRadius: 10, fontWeight: 700, fontSize: 15 }}
              >
                📥 Download Agent App (Android)
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
