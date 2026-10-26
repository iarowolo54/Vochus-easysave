'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Funding { id: string; ref: string; amount: number; method: string; note: string | null; createdAt: string }

declare global {
  interface Window {
    PaystackPop: {
      setup(opts: {
        key: string
        email: string
        amount: number
        ref: string
        metadata?: Record<string, unknown>
        callback: (resp: { reference: string }) => void
        onClose: () => void
      }): { openIframe(): void }
    }
  }
}

export default function WalletPage() {
  const { data: session, update } = useSession()
  const [amount, setAmount] = useState('')
  const [fundings, setFundings] = useState<Funding[]>([])
  const [balance, setBalance] = useState(0)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [paying, setPaying] = useState(false)
  const [paystackReady, setPaystackReady] = useState(false)
  const scriptLoaded = useRef(false)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 5000)
  }

  const loadFundings = () => {
    fetch('/api/wallet').then(r => r.json()).then(d => {
      setFundings(d.fundings ?? [])
      if (d.balance !== undefined) setBalance(d.balance)
    })
  }

  useEffect(() => {
    const agent = session?.user as any
    if (agent?.walletBalance !== undefined) setBalance(agent.walletBalance)
    loadFundings()
  }, [session])

  useEffect(() => {
    if (scriptLoaded.current) return
    scriptLoaded.current = true
    if (window.PaystackPop) { setPaystackReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://js.paystack.co/v1/inline.js'
    s.async = true
    s.onload = () => setPaystackReady(true)
    document.head.appendChild(s)
  }, [])

  async function handlePay() {
    const amt = parseFloat(amount)
    if (!amt || amt < 100) { showToast('Minimum top-up is ₦100', 'err'); return }

    setPaying(true)

    const initRes = await fetch('/api/wallet/paystack/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt }),
    })
    const initData = await initRes.json()
    if (!initRes.ok) { showToast(initData.error ?? 'Could not initialise payment', 'err'); setPaying(false); return }

    if (!window.PaystackPop) { showToast('Paystack not loaded yet — try again', 'err'); setPaying(false); return }

    const pubKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? ''
    const agentUser = session?.user as any
    const email = initData.email ?? agentUser?.email ?? `${agentUser?.agentId?.toLowerCase()}@vochus.ng`

    const verify = (reference: string) => {
      fetch('/api/wallet/paystack/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          setPaying(false)
          if (ok || d.alreadyProcessed) {
            setBalance(d.newBalance)
            setAmount('')
            loadFundings()
            update()
            showToast(`✅ ₦${amt.toLocaleString()} added to your wallet`)
          } else {
            showToast(d.error ?? 'Verification failed', 'err')
          }
        })
        .catch(() => { setPaying(false); showToast('Verification error — contact support', 'err') })
    }

    const handler = window.PaystackPop.setup({
      key: pubKey,
      email,
      amount: Math.round(amt * 100),
      ref: initData.reference,
      metadata: { agentId: agentUser?.id, agentCode: agentUser?.agentId },
      callback: (resp) => { verify(resp.reference) },
      onClose: () => { setPaying(false); showToast('Payment cancelled', 'err') },
    })

    handler.openIframe()
  }

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG')}`
  const totalFunded = fundings.reduce((s, f) => s + f.amount, 0)

  return (
    <>
      <div className="page-header">
        <h2>Wallet Top-Up</h2>
        <p>Fund your agent capital wallet via Paystack — card, bank transfer, or USSD</p>
      </div>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="stat-card green">
          <div className="stat-icon" style={{ background: 'var(--gl)' }}>💼</div>
          <div className="stat-lbl">Current Balance</div>
          <div className="stat-val">{fmt(balance)}</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon" style={{ background: 'var(--bl)' }}>📥</div>
          <div className="stat-lbl">Total Funded</div>
          <div className="stat-val">{fmt(totalFunded)}</div>
          <div className="stat-sub">{fundings.length} top-ups</div>
        </div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-title">Top Up via Paystack</div>
          <p style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 16 }}>
            Pay securely with card, bank transfer, or USSD. Funds are credited instantly after payment.
          </p>
          <label className="flabel">Amount (₦) *</label>
          <input
            className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="Enter amount (min ₦100)"
            style={{ fontSize: 28, fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, textAlign: 'center', padding: 14, marginBottom: 14 }}
            value={amount} onChange={e => setAmount(nonNegativeString(e.target.value))}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {[1000, 5000, 10000, 50000].map(n => (
              <button key={n} className="btn btn-out btn-sm" onClick={() => setAmount(String(n))}>
                +{fmt(n)}
              </button>
            ))}
          </div>
          {amount && parseFloat(amount) >= 100 && (
            <div style={{ background: 'var(--gl)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--g)', marginBottom: 14, fontWeight: 600 }}>
              You will pay: {fmt(parseFloat(amount))} → your wallet balance becomes {fmt(balance + parseFloat(amount))}
            </div>
          )}
          <button
            className="btn btn-g"
            style={{ width: '100%', fontSize: 15, padding: '13px 0' }}
            disabled={paying || !paystackReady || !amount || parseFloat(amount) < 100}
            onClick={handlePay}
          >
            {!paystackReady ? '⏳ Loading Paystack…' : paying ? '⏳ Opening payment…' : `Pay ${amount ? fmt(parseFloat(amount)) : ''} with Paystack`}
          </button>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mu)', textAlign: 'center' }}>
            🔒 Secured by Paystack · Card · Bank Transfer · USSD
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">Funding History</div>
            {fundings.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 12 }}>No top-ups yet</div>
            )}
            {fundings.slice(0, 8).map((f, i) => (
              <div key={f.id} className="cust-row" style={{ padding: '9px 0', borderBottom: i < Math.min(fundings.length, 8) - 1 ? '1px solid var(--bdr)' : 'none' }}>
                <div className="av av-g" style={{ fontSize: 13 }}>
                  {f.method === 'Paystack' ? '💳' : '🏦'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cust-name" style={{ fontSize: 13 }}>
                    {f.method === 'Paystack' ? 'Paystack Top-Up' : 'Wallet Funding'}
                  </div>
                  <div className="cust-sub">{f.ref} · {new Date(f.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
                </div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, color: 'var(--g)', whiteSpace: 'nowrap' }}>
                  +{fmt(f.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`a-toast${toast ? ' show' : ''}`} style={toastType === 'err' ? { background: 'var(--rd)', color: '#fff' } : {}}>
        {toast}
      </div>
    </>
  )
}
