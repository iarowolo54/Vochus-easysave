'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Modal, Pager, SearchField, Empty, LoadError, TableSkeleton, nairaKobo, shortDate, useDebounced } from './admin-ui'

const PAGE_SIZE = 25

type Source = 'loan' | 'repayment' | 'redemption' | 'reward' | 'savings'
const SOURCE_LABELS: Record<Source, string> = { loan: 'Loans', repayment: 'Repayments', redemption: 'Redemptions', reward: 'Rewards', savings: 'Savings' }
const ALL_SOURCES: Source[] = ['savings', 'loan', 'repayment', 'redemption', 'reward']

interface Entry {
  id: string; date: string; source: Source; commission: number; baseAmount: number
  customerId: string | null; customerName: string | null; planGoal: string | null; ref: string | null; status: string | null
}
interface Resp { agent: { id: string; name: string; agentId: string }; entries: Entry[]; total: number; count: number }

type Preset = 'month' | '3m' | 'year' | 'all'
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date()
  // Local calendar date (avoid toISOString's UTC shift, which moves a day in WAT).
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = iso(now)
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (p === '3m') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: today }
  if (p === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today }
  return { from: '', to: '' }
}

export function CommissionHistoryDrawer({ agent, onClose }: { agent: { id: string; name: string; agentId: string }; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const dq = useDebounced(q, 250)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (sources.length) params.set('sources', sources.join(','))
      const res = await fetch(`/api/admin/commission/${agent.id}/history?${params.toString()}`)
      if (!res.ok) throw new Error('load failed')
      const json = await res.json()
      if (my === seq.current) setData(json)
    } catch { if (my === seq.current) setFailed(true) } finally { if (my === seq.current) setLoading(false) }
  }, [agent.id, from, to, sources])

  useEffect(() => { load() }, [load])

  function applyPreset(p: Preset) { setPreset(p); const r = presetRange(p); setFrom(r.from); setTo(r.to) }
  function toggleSource(s: Source) { setSources(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]) }

  // Instant client-side filtering for search + status (no refetch).
  const statusOptions = useMemo(() => Array.from(new Set((data?.entries ?? []).map(e => e.status).filter(Boolean))) as string[], [data])
  useEffect(() => { if (status && !statusOptions.includes(status)) setStatus('') }, [statusOptions, status])
  const visible = useMemo(() => {
    const needle = dq.trim().toLowerCase()
    return (data?.entries ?? []).filter(e => {
      if (status && e.status !== status) return false
      if (needle) { const hay = `${e.customerName ?? ''} ${e.customerId ?? ''}`.toLowerCase(); if (!hay.includes(needle)) return false }
      return true
    })
  }, [data, dq, status])
  useEffect(() => { setPage(1) }, [from, to, sources, dq, status])
  const paginated = useMemo(() => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [visible, page])
  const shownTotal = useMemo(() => Math.round(visible.reduce((s, e) => s + e.commission, 0) * 100) / 100, [visible])

  return (
    <Modal title={`${agent.name} — commission history`} sub={agent.agentId} onClose={onClose} icon="commission" size="lg">
      <div className="ch-sum">
        <div><span className="ch-sum-lbl">Commission earned{(from || to || sources.length || status || dq) ? ' (filtered)' : ''}</span>
          <strong className="ch-sum-val">{nairaKobo(shownTotal)}</strong></div>
        <div className="ch-sum-count">{visible.length} {visible.length === 1 ? 'entry' : 'entries'}</div>
      </div>
      <p className="ch-note" role="note">Total earned over time, reconstructed from records — not the current balance (payouts reduce the balance). Redemption figures from some flows are estimates.</p>

      <div className="ch-filters">
        <div className="seg" role="group" aria-label="Date range">
          {([['month', 'This month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['all', 'All time']] as [Preset, string][]).map(([p, l]) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => applyPreset(p)}>{l}</button>
          ))}
        </div>
        <div className="ch-chips" role="group" aria-label="Commission source">
          {ALL_SOURCES.map(s => (
            <button key={s} type="button" className={`chip${sources.includes(s) ? ' is-on' : ''}`} aria-pressed={sources.includes(s)} onClick={() => toggleSource(s)}>{SOURCE_LABELS[s]}</button>
          ))}
        </div>
        <div className="ch-row2">
          <SearchField value={q} onChange={setQ} placeholder="Customer name or ID" label="Search commission history" />
          {statusOptions.length > 1 && (
            <select className="a-input ch-status" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? <TableSkeleton rows={5} cols={4} />
        : failed ? <LoadError what="commission history" onRetry={load} />
        : visible.length === 0 ? <Empty icon="commission" title="No commission in this view" text="Try a wider date range or clear the filters. Savings and enrolments don’t earn commission in the current model, so they won’t appear here." />
        : (
          <>
          <div className="tbl-wrap tbl-stack">
            <table>
              <thead><tr><th>Date</th><th>Source</th><th>Customer</th><th className="num">From</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {paginated.map(e => (
                  <tr key={e.id}>
                    <td data-label="Date">{shortDate(e.date)}</td>
                    <td data-label="Source"><span className="bdg bdg-grey">{SOURCE_LABELS[e.source]}</span></td>
                    <td data-label="Customer">
                      <span className="td-name ui-block">{e.customerName ?? '—'}</span>
                      {e.customerId && <span className="td-sub ui-block">{e.customerId}{e.planGoal ? ` · ${e.planGoal}` : ''}</span>}
                    </td>
                    <td className="num" data-label="From">{nairaKobo(e.baseAmount)}</td>
                    <td className="num am-strong" data-label="Commission">{nairaKobo(e.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} />
          </>
        )}
    </Modal>
  )
}
