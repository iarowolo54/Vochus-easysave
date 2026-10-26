'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface PlatformWallet {
  id: string
  type: string
  balance: number
  updatedAt: string
}

interface Today {
  savings: number
  redemptions: number
  registrations: number
  walletFunding: number
  disbursements: number
  repayments: number
}

interface TreasuryData {
  wallets: PlatformWallet[]
  totalAgentFloat: number
  totalAgentCommission: number
  totalCustomerSavings: number
  lowBalanceAgents: number
  totalAgents: number
  today: Today
}

export default function TreasuryPage() {
  const [data, setData] = useState<TreasuryData>({
    wallets: [], totalAgentFloat: 0, totalAgentCommission: 0,
    totalCustomerSavings: 0, lowBalanceAgents: 0, totalAgents: 0,
    today: { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const [showInjectModal, setShowInjectModal] = useState(false)
  const [injectAmount, setInjectAmount] = useState('')
  const [injectRef, setInjectRef] = useState('')
  const [injectLoading, setInjectLoading] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const [wRes, aRes] = await Promise.all([
      fetch('/api/admin/wallets/platform'),
      fetch('/api/admin/wallets'),
    ])
    if (wRes.ok) {
      const d = await wRes.json()
      const agents = aRes.ok ? (await aRes.json()).agents ?? [] : []
      setData({
        wallets: d.wallets ?? [],
        totalAgentFloat: d.totalAgentFloat ?? 0,
        totalAgentCommission: d.totalAgentCommission ?? 0,
        totalCustomerSavings: d.totalCustomerSavings ?? 0,
        lowBalanceAgents: agents.filter((a: { walletBalance: number }) => a.walletBalance < 10000).length,
        totalAgents: agents.length,
        today: d.today ?? { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 },
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const w = (type: string) => data.wallets.find(x => x.type === type)?.balance ?? 0

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
  const fmtS = (n: number) => n >= 1000000 ? `₦${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `₦${(n / 1000).toFixed(0)}K` : fmt(n)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)',
    fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif', background: 'var(--surface2)',
    color: 'var(--text)', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6,
  }

  async function handleInject() {
    const amt = parseFloat(injectAmount)
    if (!amt || amt <= 0) return
    setInjectLoading(true)
    const res = await fetch('/api/admin/wallets/inject-capital', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, reference: injectRef }),
    })
    setInjectLoading(false)
    if (res.ok) { setInjectAmount(''); setInjectRef(''); setShowInjectModal(false); showToast('✅ Capital injected successfully'); load() }
    else { const d = await res.json().catch(() => ({})); showToast((d as { error?: string }).error ?? 'Injection failed') }
  }

  const wallets = [
    {
      key: 'capital', label: 'Capital Wallet', badge: 'W-1', badgeClass: 'bdg-g', icon: '💰',
      color: 'var(--green)', gradient: 'linear-gradient(90deg,#1a6b3a,#2ecc71)',
      balance: w('Capital'), desc: 'Owner equity + investor capital',
      stats: [
        { label: 'Injected today', val: data.today.walletFunding > 0 ? `+${fmtS(data.today.walletFunding)}` : '—', color: 'var(--green)' },
        { label: 'Not used in agent model', val: '', color: 'var(--text3)' },
      ],
    },
    {
      key: 'float', label: 'Float Wallet', badge: 'W-2', badgeClass: 'bdg-b', icon: '🔄',
      color: 'var(--blue)', gradient: 'linear-gradient(90deg,var(--blue),#60a5fa)',
      balance: w('Float'), desc: 'Platform working capital pool',
      stats: [
        { label: 'Active agents', val: `${data.totalAgents}`, color: 'var(--text2)' },
        { label: 'Not used in agent model', val: '', color: 'var(--text3)' },
      ],
    },
    {
      key: 'agent', label: 'Agent Float Wallets', badge: 'W-3', badgeClass: 'bdg-t', icon: '🤝',
      color: 'var(--teal)', gradient: 'linear-gradient(90deg,var(--teal),#22d3ee)',
      balance: data.totalAgentFloat, desc: `Combined across ${data.totalAgents} agents`,
      stats: [
        { label: data.lowBalanceAgents > 0 ? `⚠️ ${data.lowBalanceAgents} low balance` : '✅ All healthy', val: '', color: 'var(--amber)' },
        { label: 'Collections today', val: data.today.savings > 0 ? `-${fmtS(data.today.savings * 0.98)}` : '—', color: 'var(--red)' },
      ],
    },
    {
      key: 'savings', label: 'Customer Savings Wallets', badge: 'W-4', badgeClass: 'bdg-a', icon: '💳',
      color: 'var(--amber)', gradient: 'linear-gradient(90deg,var(--amber),#fbbf24)',
      balance: data.totalCustomerSavings, desc: 'Individual savings accounts',
      stats: [
        { label: 'Deposited today', val: data.today.savings > 0 ? `+${fmtS(data.today.savings)}` : '—', color: 'var(--green)' },
        { label: 'Redeemed today', val: data.today.redemptions > 0 ? `-${fmtS(data.today.redemptions)}` : '—', color: 'var(--red)' },
      ],
    },
    {
      key: 'pool', label: 'Savings Pool', badge: 'W-5', badgeClass: 'bdg-p', icon: '🏊',
      color: 'var(--purple)', gradient: 'linear-gradient(90deg,var(--purple),#a78bfa)',
      balance: w('SavingsPool'), desc: 'Platform liability for customer savings',
      stats: [
        { label: 'In today', val: data.today.savings > 0 ? `+${fmtS(data.today.savings * 0.98)}` : '—', color: 'var(--green)' },
        { label: 'Out today', val: data.today.redemptions > 0 ? `-${fmtS(data.today.redemptions)}` : '—', color: 'var(--red)' },
      ],
    },
    {
      key: 'redemption', label: 'Redemption Wallet', badge: 'W-6', badgeClass: 'bdg-r', icon: '🎯',
      color: 'var(--red)', gradient: 'linear-gradient(90deg,var(--red),#f87171)',
      balance: w('Redemption'), desc: 'Agent pays customer directly (not used)',
      stats: [
        { label: 'Not active in current model', val: '', color: 'var(--text3)' },
        { label: 'Agent float backs payouts', val: '', color: 'var(--text3)' },
      ],
    },
    {
      key: 'revenue', label: 'Revenue / Profit', badge: 'W-7', badgeClass: 'bdg-g', icon: '💹',
      color: 'var(--green)', gradient: 'linear-gradient(90deg,#16a34a,#14532d)',
      balance: w('Revenue'), desc: 'Platform earnings from fees & charges',
      stats: [
        { label: 'Earned today', val: data.today.savings > 0 ? `+${fmtS(data.today.savings * 0.016)}` : '—', color: 'var(--green)' },
        { label: 'Total revenue', val: fmtS(w('Revenue')), color: 'var(--green)' },
      ],
    },
    {
      key: 'commission', label: 'Agent Commission', badge: 'W-8', badgeClass: 'bdg-t', icon: '🏅',
      color: 'var(--teal)', gradient: 'linear-gradient(90deg,var(--teal),#2dd4bf)',
      balance: data.totalAgentCommission, desc: 'Pending commission across all agents',
      stats: [
        { label: 'Earned today', val: data.today.savings > 0 ? `+${fmtS(data.today.savings * 0.004)}` : '—', color: 'var(--teal)' },
        { label: 'Pending payout', val: fmtS(data.totalAgentCommission), color: 'var(--teal)' },
      ],
    },
  ]

  return (
    <>
      {/* Header */}
      <div className="pg-hd treasury-hd">
        <div>
          <h1>Platform Treasury</h1>
          <p>Agent-Funded Capital Model — Agent Float (W-3) backs Customer Savings · Revenue · Commission</p>
        </div>
        <div className="treasury-hd-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowInjectModal(true)}>＋ Inject Capital</button>
        </div>
      </div>

      {/* 8 Wallet Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 48 }}>Loading wallets…</div>
      ) : (
        <div className="treasury-wallets">
          {wallets.map(card => (
            <div key={card.key} className="treasury-wallet-card">
              <div style={{ height: 5, background: card.gradient }} />
              <div style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: card.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{card.icon}</div>
                  <span className={`bdg ${card.badgeClass}`} style={{ fontSize: 10 }}>{card.badge}</span>
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 22, fontWeight: 800, color: card.color, letterSpacing: '-.5px' }}>{fmt(card.balance)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{card.desc}</div>
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  {card.stats.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginTop: i > 0 ? 3 : 0 }}>
                      <span style={{ color: 'var(--text3)' }}>{s.label}</span>
                      {s.val && <span style={{ color: s.color, fontWeight: 700 }}>{s.val}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .treasury-hd { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .treasury-hd-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .treasury-solvency-pill { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; }
        .treasury-wallets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
        .treasury-wallet-card { background: var(--surface); border: 2px solid var(--border); border-radius: var(--r); overflow: hidden; transition: all .2s; }
        .treasury-wallet-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.1); transform: translateY(-2px); }
        @media (max-width: 1180px) { .treasury-wallets { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 900px) { .treasury-wallets { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) {
          .treasury-wallets { grid-template-columns: 1fr; gap: 12px; }
          .treasury-hd { align-items: flex-start; }
          .treasury-hd-actions { width: 100%; }
          .treasury-solvency-pill { flex: 1; justify-content: center; }
        }
      `}</style>

      {/* Inject Capital Modal (from header button) */}
      {showInjectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r)', padding: 28, width: 420, boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 17, fontWeight: 700, margin: 0 }}>＋ Inject Capital</h3>
              <button onClick={() => setShowInjectModal(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Amount (₦)</label>
              <input type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="e.g. 1000000" value={injectAmount} onChange={e => setInjectAmount(nonNegativeString(e.target.value))} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Reference (optional)</label>
              <input type="text" placeholder="e.g. INV-2025-001" value={injectRef} onChange={e => setInjectRef(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ background: 'var(--blue-lt)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--blue)', marginBottom: 16 }}>
              ℹ️ Funds injected here flow into the Capital Wallet
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowInjectModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleInject} disabled={injectLoading}>
                {injectLoading ? 'Injecting…' : 'Inject Capital'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
