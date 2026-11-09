'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Icons } from '@/components/ui/icons'
import { digitsOnly } from '@/lib/numeric'
import { IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import {
  ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, dateTime, shortDate, nairaKobo, useDebounced, useToast,
  ResultModal, type Result, type ResultRow,
} from '../_components/admin-ui'
import { ManualModeBanner, PayoutModeError, usePayoutMode } from '../_components/payout-mode'

interface RedemptionRecord {
  id: string
  ref: string
  type: string
  reason: string
  note: string | null
  status: string
  balance: number
  currentBalance: number
  balanceChanged: boolean
  needsReview: boolean
  agentActive: boolean
  nameMismatch: boolean
  penalty: number
  netPayout: number
  token: string | null
  tokenExpiry: string | null
  payoutMethod: string
  accountNumber: string | null
  accountName: string | null
  bankName: string | null
  bankTransferStatus: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
  customerName: string
  customerId: string
  customerPhone?: string | null
  agentName: string
  agentId: string
  savingsPlanId: string
  planStatus: string
  planGoal?: string | null
  planStartDate?: string | null
  planMaturityDate?: string | null
  customerPlans?: { id: string; goal: string; balance: number; status: string; startDate: string; maturityDate: string }[]
}

interface PageData {
  pending: number
  approved: number
  rejected: number
  tokensToday: number
  records: RedemptionRecord[]
}

interface CompletedRedemption {
  id: string
  ref: string
  amount: number
  customerName: string | null
  customerId: string | null
  agentName: string
  agentId: string
  method: string | null
  status: string
  createdAt: string
}

interface CompletedStats {
  totalRedemptions: number
  totalRedeemedAmount: number
  todayCount: number
  todayAmount: number
}

interface ActivePlan {
  id: string; customerName: string; customerId: string; balance: number; status: string; periodDays: number; dailyAmount: number; cadence: string
}

interface PinTarget { nameMismatch: boolean;
  id: string; ref: string; customerName: string; customerId: string; amount: number
  payoutMethod: string; accountName: string | null; bankName: string | null; accountNumber: string | null
}

type Tab = 'pending' | 'completed' | 'history'
type HistoryStatus = 'all' | 'approved' | 'rejected'

const REASONS = [
  'Medical emergency',
  'Family bereavement',
  'Job loss / financial hardship',
  'School fees / education',
  'Business emergency',
  'Customer request — personal',
  'Other (see note)',
]

const PAGE_SIZE = 25
const PLAN_LIMIT = 100 // the plan picker asks the savings API for up to this many active plans
const PENDING_STATUSES = [...IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved'), 'Processing']
const DECIDABLE = ['Pending', 'TokenValidated', 'AgentApproved']
const NO_CONNECTION = 'No connection. Check your internet and try again.'

/** Sent a code that hasn't been confirmed yet. Only a request an admin made (no code) can be approved from Pending. */
const needsCode = (r: { status: string; tokenExpiry: string | null }) => r.status === 'Pending' && !!r.tokenExpiry
/** Paystack's final statuses that don't say whether money moved, so a person has to look. */
const UNCLEAR_FINAL = ['blocked', 'rejected']
const CHECKABLE = ['Processing', 'AwaitingOTP', 'Finalizing']
const cashBlocked = (r: { agentActive: boolean; payoutMethod: string | null }) => !r.agentActive && !isBank(r.payoutMethod)
const isBank = (method: string | null | undefined) => method === 'Bank Transfer' || method === 'BankTransfer'
const last4 = (acct: string | null) => acct ? `••••${acct.slice(-4)}` : ''
const typeLabel = (t: string) => t === 'early' ? 'Early exit' : 'After maturity'

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'Pending': return <span className="bdg bdg-grey">Waiting for customer code</span>
    case 'TokenValidated': return <span className="bdg bdg-a">Waiting for agent</span>
    case 'AgentApproved': return <span className="bdg bdg-b">Agent approved</span>
    case 'AwaitingOTP': return <span className="bdg bdg-a">Waiting for Paystack code</span>
    case 'Processing': return <span className="bdg bdg-a">Check with Paystack</span>
    case 'Finalizing': return <span className="bdg bdg-b">Finalising payout</span>
    case 'Approved': return <span className="bdg bdg-g">Approved</span>
    case 'Rejected': return <span className="bdg bdg-r">Rejected</span>
    default: return <span className="bdg bdg-grey">{status}</span>
  }
}

function TypeBadge({ type }: { type: string }) {
  return <span className={`bdg ${type === 'early' ? 'bdg-a' : 'bdg-b'}`}>{typeLabel(type)}</span>
}

function DlRow({ label, children, total }: { label: string; children: ReactNode; total?: boolean }) {
  return <div className={total ? 'is-total' : undefined}><dt>{label}</dt><dd>{children}</dd></div>
}

function csvDownload(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function RedemptionsPage() {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [toastNode, toast] = useToast()

  // New request
  const [showModal, setShowModal] = useState(false)
  const [plans, setPlans] = useState<ActivePlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansFailed, setPlansFailed] = useState(false)
  const [form, setForm] = useState({ savingsPlanId: '', type: 'early', reason: '', note: '' })
  const [formErrors, setFormErrors] = useState<{ plan?: string; reason?: string }>({})
  const [preview, setPreview] = useState<{ balance: number; savingsFee: number; netPayout: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')

  // Approve (PIN), Paystack OTP, reject
  const [pinModal, setPinModal] = useState<PinTarget | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [approveError, setApproveError] = useState('')
  const [transferRef, setTransferRef] = useState('')
  const { modes: payoutModes, error: payoutModeError, reload: reloadPayoutMode } = usePayoutMode()
  const manual = payoutModes?.customer === 'manual'
  const [pinLoading, setPinLoading] = useState(false)
  const [otpModal, setOtpModal] = useState<{ id: string; ref: string; customerName: string; amount: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [otpValue, setOtpValue] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<RedemptionRecord | null>(null)
  const [rejectBusy, setRejectBusy] = useState(false)
  const [rejectError, setRejectError] = useState('')
  const [checking, setChecking] = useState(false)

  const [detail, setDetail] = useState<RedemptionRecord | null>(null)

  // All requests filters
  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatus>('all')
  const [historyPage, setHistoryPage] = useState(1)

  // Completed payouts
  const [completed, setCompleted] = useState<CompletedRedemption[]>([])
  const [completedDetail, setCompletedDetail] = useState<CompletedRedemption | null>(null)
  const [completedStats, setCompletedStats] = useState<CompletedStats | null>(null)
  const [completedSearch, setCompletedSearch] = useState('')
  const completedQ = useDebounced(completedSearch.trim())
  const [completedDate, setCompletedDate] = useState('')
  const [completedLoading, setCompletedLoading] = useState(false)
  const [completedFailed, setCompletedFailed] = useState(false)
  const [completedPage, setCompletedPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/early-redemption')
      if (!res.ok) throw new Error()
      setData(await res.json() as PageData)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCompleted = useCallback(async () => {
    setCompletedLoading(true); setCompletedFailed(false)
    try {
      const params = new URLSearchParams()
      if (completedQ) params.set('search', completedQ)
      if (completedDate) params.set('date', completedDate)
      const res = await fetch(`/api/admin/redemptions?${params}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<CompletedStats> & { redemptions?: CompletedRedemption[] }
      setCompleted(d.redemptions ?? [])
      setCompletedPage(1)
      setCompletedStats({
        totalRedemptions: d.totalRedemptions ?? 0,
        totalRedeemedAmount: d.totalRedeemedAmount ?? 0,
        todayCount: d.todayCount ?? 0,
        todayAmount: d.todayAmount ?? 0,
      })
    } catch {
      setCompletedFailed(true)
    } finally {
      setCompletedLoading(false)
    }
  }, [completedQ, completedDate])

  const loadPlans = useCallback(async () => {
    setPlansLoading(true); setPlansFailed(false)
    try {
      const res = await fetch('/api/admin/savings?status=Active&page=1&limit=100')
      if (!res.ok) throw new Error()
      const d = await res.json() as { plans?: ActivePlan[] }
      setPlans((d.plans ?? []).map(p => ({
        id: p.id, customerName: p.customerName, customerId: p.customerId, balance: p.balance, status: p.status, periodDays: p.periodDays, dailyAmount: p.dailyAmount, cadence: p.cadence,
      })))
    } catch {
      setPlansFailed(true)
    } finally {
      setPlansLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'completed') loadCompleted() }, [tab, loadCompleted])
  useEffect(() => { setHistoryPage(1) }, [historySearch, historyTypeFilter, historyStatusFilter])

  // ── New request ──
  async function calcPreview(planId: string) {
    const plan = plans.find(p => p.id === planId)
    if (!plan) { setPreview(null); return }
    // The server works the fee out, so the preview always matches what the request will carry.
    try {
      const res = await fetch(`/api/admin/early-redemption/preview?planId=${encodeURIComponent(planId)}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { balance: number; fee: number; netPayout: number }
      setPreview({ balance: d.balance, savingsFee: d.fee, netPayout: d.netPayout })
    } catch {
      setPreview(null)
    }
  }

  function onFormChange(key: keyof typeof form, val: string) {
    const next = { ...form, [key]: val }
    setForm(next)
    setCreateError('')
    if (key === 'savingsPlanId') setFormErrors(e => ({ ...e, plan: undefined }))
    if (key === 'reason') setFormErrors(e => ({ ...e, reason: undefined }))
    if (key === 'savingsPlanId' || key === 'type') calcPreview(next.savingsPlanId)
  }

  function openNewRequest() {
    setForm({ savingsPlanId: '', type: 'early', reason: '', note: '' })
    setPreview(null); setFormErrors({}); setCreateError('')
    setShowModal(true)
    loadPlans()
  }

  async function handleSubmit() {
    const errs: { plan?: string; reason?: string } = {}
    if (!form.savingsPlanId) errs.plan = 'Choose the customer’s plan.'
    if (!form.reason) errs.reason = 'Choose a reason.'
    setFormErrors(errs)
    if (errs.plan || errs.reason) return
    setSubmitting(true); setCreateError('')
    try {
      const res = await fetch('/api/admin/early-redemption', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { setCreateError(await errorOf(res, 'The request wasn’t created. Try again.')); return }
      const d = await res.json().catch(() => ({})) as { ref?: string; netPayout?: number }
      setShowModal(false)
      setForm({ savingsPlanId: '', type: 'early', reason: '', note: '' })
      setPreview(null)
      toast(d.ref ? `Request ${d.ref} created. Net payout ${nairaKobo(d.netPayout)}.` : 'Redemption request created', 'success')
      setTab('pending')
      load()
    } catch {
      setCreateError(NO_CONNECTION)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Approve / reject ──
  function openApprove(r: RedemptionRecord) {
    setPinModal({
      id: r.id, ref: r.ref, customerName: r.customerName, customerId: r.customerId, amount: r.netPayout, nameMismatch: r.nameMismatch,
      payoutMethod: r.payoutMethod ?? 'Cash', accountName: r.accountName ?? null, bankName: r.bankName ?? null, accountNumber: r.accountNumber ?? null,
    })
    setPinValue(''); setPinError(''); setApproveError(''); setTransferRef('')
  }

  function openReject(r: RedemptionRecord) {
    setRejectError(''); setRejectTarget(r)
  }

  async function confirmReject() {
    if (!rejectTarget) return
    setRejectBusy(true); setRejectError('')
    try {
      const res = await fetch(`/api/admin/early-redemption/${rejectTarget.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      })
      if (res.status === 409) {
        // It has moved on, so rejecting again can't work.
        toast(await errorOf(res, 'This request has already been decided.'))
        setRejectTarget(null)
        load()
        return
      }
      if (!res.ok) { setRejectError(await errorOf(res, 'The request wasn’t rejected. Try again.')); return }
      toast(`${rejectTarget.ref} rejected. ${rejectTarget.customerName}’s plan is active again.`, 'success')
      setRejectTarget(null)
      load()
    } catch {
      setRejectError(NO_CONNECTION)
    } finally {
      setRejectBusy(false)
    }
  }

  async function confirmApprove() {
    if (!pinModal) return
    if (!pinValue.trim()) { setPinError('Enter your approval PIN.'); return }
    setPinLoading(true); setPinError(''); setApproveError('')
    try {
      const res = await fetch(`/api/admin/early-redemption/${pinModal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          manual && isBank(pinModal.payoutMethod) && transferRef.trim()
            ? { action: 'approve', pin: pinValue, adminNote: transferRef.trim(), overrideNameMismatch: pinModal.nameMismatch }
            : { action: 'approve', pin: pinValue, overrideNameMismatch: pinModal.nameMismatch },
        ),
      })
      if (res.status === 409) {
        // The request has moved on, so approving again can't work: show its current state and the way out.
        const msg = await errorOf(res, 'This request has changed. Nothing was paid.')
        const current = records.find(r => r.id === pinModal.id)
        setPinModal(null); setPinValue(''); setApproveError('')
        toast(msg)
        if (current) setDetail(current)
        load()
        return
      }
      if (!res.ok) {
        const msg = await errorOf(res, 'The payout wasn’t approved. Nothing was paid. Try again.')
        if (/pin/i.test(msg)) setPinError(msg); else setApproveError(msg)
        return
      }
      const d = await res.json().catch(() => ({})) as { status?: string; bankTransferStatus?: string | null; reviewNeeded?: boolean }
      const target = pinModal
      setPinModal(null); setPinValue('')
      if (d.status === 'Processing') {
        toast(`Paystack says “${d.bankTransferStatus ?? 'unknown'}”, so this isn’t recorded as paid. Use Check with Paystack on the request.`)
        load()
        return
      }
      if (d.status === 'AwaitingOTP') {
        setOtpValue(''); setOtpError('')
        setOtpModal({ id: target.id, ref: target.ref, customerName: target.customerName, amount: target.amount })
        toast('Paystack sent a code to your admin phone. Enter it to finish the payout.')
        load()
        return
      }
      const base: ResultRow[] = [
        { label: 'Customer', value: `${target.customerName} · ${target.customerId}` },
        { label: 'Reference', value: target.ref },
      ]
      if (d.reviewNeeded) toast('Money arrived on this plan during the payout and was left on it. This needs a manual review.')
      if (isBank(target.payoutMethod)) {
        const wasManual = d.bankTransferStatus === 'manual'
        const sent = d.bankTransferStatus === 'success' || wasManual
        setResult({
          heading: wasManual ? 'Payout recorded' : sent ? 'Payout sent' : 'Payout approved',
          title: wasManual ? `${nairaKobo(target.amount)} marked as paid` : sent ? `${nairaKobo(target.amount)} sent` : 'Paystack is sending the money',
          pending: !sent,
          text: wasManual
            ? <>Recorded as paid manually. No Paystack transfer was made, so make sure {target.accountName ?? target.customerName} has been paid. The plan is closed.</>
            : sent
            ? <>Paystack has paid {target.accountName ?? target.customerName}’s bank account. The plan is closed.</>
            : <>The plan is closed. The transfer usually lands within minutes; check the request’s transfer status to confirm.</>,
          rows: [...base, { label: 'Account', value: `${target.accountName ?? '—'} · ${target.bankName ?? '—'} ${last4(target.accountNumber)}` }, { label: 'Net payout', value: nairaKobo(target.amount), total: true }],
        })
      } else {
        setResult({
          heading: 'Payout approved', title: `${nairaKobo(target.amount)} approved`,
          text: <>{target.customerName}’s plan is closed and the agent’s wallet is credited, so they can pay out the cash.</>,
          rows: [...base, { label: 'Paid as', value: 'Cash through the agent' }, { label: 'Net payout', value: nairaKobo(target.amount), total: true }],
        })
      }
      load()
    } catch {
      setApproveError('No connection. We can’t tell if this went through. Close this, refresh the list and check before trying again.')
    } finally {
      setPinLoading(false)
    }
  }

  async function submitOtp() {
    if (!otpModal) return
    if (!otpValue.trim()) { setOtpError('Enter the code Paystack sent you.'); return }
    setOtpLoading(true); setOtpError('')
    try {
      const res = await fetch(`/api/admin/early-redemption/${otpModal.id}/finalize-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: otpValue.trim() }),
      })
      if (res.status === 409) {
        const msg = await errorOf(res, 'This request has changed. Nothing was paid.')
        const current = records.find(r => r.id === otpModal.id)
        setOtpModal(null); setOtpValue('')
        toast(msg)
        if (current) setDetail(current)
        load()
        return
      }
      if (res.status === 502) {
        // Not a wrong code: the outcome is settled or unknown, so there's nothing to retry here.
        toast(await errorOf(res, 'We couldn’t confirm this with Paystack.'))
        setOtpModal(null); setOtpValue('')
        load()
        return
      }
      if (!res.ok) { setOtpError(await errorOf(res, 'Paystack didn’t accept that code. Check it and try again.')); return }
      const done = await res.json().catch(() => ({})) as { reviewNeeded?: boolean; status?: string; bankTransferStatus?: string }
      setOtpModal(null); setOtpValue('')
      if (done.status === 'Finalizing') {
        toast(`Paystack says “${done.bankTransferStatus ?? 'unknown'}”, so this isn’t recorded as paid yet. Use Check with Paystack on the request.`)
        load()
        return
      }
      setResult({
        heading: 'Payout sent', title: `${nairaKobo(otpModal.amount)} sent`,
        text: <>Paystack accepted the code and completed the transfer to {otpModal.customerName}.{done.reviewNeeded && <> Money arrived on this plan during the payout and was left on it. This needs a manual review; it’s flagged in the audit log.</>}</>,
        rows: [{ label: 'Customer', value: otpModal.customerName }, { label: 'Reference', value: otpModal.ref }, { label: 'Net payout', value: nairaKobo(otpModal.amount), total: true }],
      })
      load()
    } catch {
      setOtpError('No connection. We can’t tell if the transfer finished. Refresh the list and check before trying again.')
    } finally {
      setOtpLoading(false)
    }
  }

  async function checkWithPaystack(r: RedemptionRecord) {
    setChecking(true)
    try {
      const res = await fetch(`/api/admin/early-redemption/${r.id}/verify`, { method: 'POST' })
      if (!res.ok) { toast(await errorOf(res, 'We couldn’t get an answer from Paystack. Nothing has changed. Try again shortly.')); return }
      const d = await res.json().catch(() => ({})) as { status?: string; bankTransferStatus?: string | null; reviewNeeded?: boolean }
      if (d.status && CHECKABLE.includes(d.status) && d.status !== 'AwaitingOTP') {
        toast(`${r.ref}: Paystack says “${d.bankTransferStatus ?? 'unknown'}”. ${UNCLEAR_FINAL.includes(d.bankTransferStatus ?? '') ? 'That’s final, but it doesn’t say if money moved. Check the Paystack dashboard.' : 'It isn’t finished, so nothing has changed. Check again later.'}`)
        load()
        return
      }
      const released = d.bankTransferStatus ? `Paystack says it ${d.bankTransferStatus === 'reversed' ? 'was reversed' : d.bankTransferStatus === 'abandoned' ? 'was abandoned (the code expired)' : 'failed'}` : 'Paystack has no record of it'
      toast(d.status === 'Approved'
        ? `${r.ref}: Paystack confirms the transfer, so the payout is recorded.${d.reviewNeeded ? ' Money arrived on the plan during the payout and was left on it. This needs a manual review.' : ''}`
        : d.status === 'AwaitingOTP' ? `${r.ref}: Paystack needs a code. Enter it from the list.`
        : `${r.ref}: ${released}, so no money went out. It’s back on the plan, so you can approve or reject the request.`, d.reviewNeeded ? undefined : 'success')
      setDetail(null)
      load()
    } catch {
      toast(NO_CONNECTION)
    } finally {
      setChecking(false)
    }
  }

  // ── Derived lists ──
  const records = data?.records ?? []

  // An open detail shows the latest figures after the list reloads.
  useEffect(() => {
    setDetail(d => (d ? data?.records.find(r => r.id === d.id) ?? d : d))
  }, [data])
  const pending = records.filter(r => PENDING_STATUSES.includes(r.status))
  const awaitingOtp = pending.filter(r => r.status === 'AwaitingOTP').length
  const hq = historySearch.trim().toLowerCase()
  const history = records.filter(r => !PENDING_STATUSES.includes(r.status)).filter(r => {
    if (historyTypeFilter !== 'all' && r.type !== historyTypeFilter) return false
    if (historyStatusFilter !== 'all' && r.status.toLowerCase() !== historyStatusFilter) return false
    if (hq && !r.customerName.toLowerCase().includes(hq) && !r.ref.toLowerCase().includes(hq) && !r.agentName.toLowerCase().includes(hq)) return false
    return true
  })
  const historyFiltered = !!(hq || historyTypeFilter !== 'all' || historyStatusFilter !== 'all')

  function exportCurrent() {
    const stamp = new Date().toISOString().slice(0, 10)
    if (tab === 'completed') {
      if (!completed.length) { toast('Nothing to export yet'); return }
      csvDownload(`completed-payouts-${stamp}.csv`, [
        ['Reference', 'Customer', 'Customer ID', 'Agent', 'Agent ID', 'Amount', 'Method', 'Date', 'Status'],
        ...completed.map(r => [r.ref, r.customerName, r.customerId, r.agentName, r.agentId, r.amount, r.method, r.createdAt, r.status]),
      ])
    } else {
      const rows = tab === 'pending' ? pending : history
      if (!rows.length) { toast('Nothing to export yet'); return }
      csvDownload(`redemption-${tab === 'pending' ? 'pending' : 'requests'}-${stamp}.csv`, [
        ['Reference', 'Customer', 'Customer ID', 'Agent', 'Agent ID', 'Type', 'Balance', 'Fee', 'Net payout', 'Payout method', 'Status', 'Reason', 'Requested', 'Decided', 'Decided by'],
        ...rows.map(r => [r.ref, r.customerName, r.customerId, r.agentName, r.agentId, typeLabel(r.type), r.balance, r.penalty, r.netPayout, r.payoutMethod ?? 'Cash', r.status, r.reason, r.requestedAt, r.decidedAt, r.decidedBy]),
      ])
    }
    toast('Export downloaded', 'success')
  }

  // Skip the open when the click ends a text selection, so details in the row can still be copied.
  function openRow(r: RedemptionRecord) {
    if (window.getSelection()?.toString()) return
    setDetail(r)
  }

  function viewButton(r: RedemptionRecord) {
    return <button type="button" className="btn btn-sm btn-outline" onClick={() => setDetail(r)} aria-label={`View request ${r.ref}`}>View</button>
  }

  const statVal = (v: number, tone?: string) => !data
    ? <div className="stat-val">{loading ? '…' : '—'}</div>
    : <div className={`stat-val${v && tone ? ` ${tone}` : ''}`}>{v.toLocaleString('en-NG')}</div>

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'pending', label: 'Waiting for approval', count: data ? pending.length : undefined },
    { id: 'completed', label: 'Completed payouts' },
    { id: 'history', label: 'All requests' },
  ]

  return (
    <>
      <PageHeader
        title="Redemptions"
        sub={manual ? 'Approve early and matured savings payouts, and see every payout made. Bank transfers are paid by you, then marked as paid.' : 'Approve early and matured savings payouts, and see every payout made.'}
        actions={<>
          <button type="button" className="btn btn-outline" onClick={exportCurrent}><Icons.download size={16} aria-hidden="true" /> Export</button>
          <button type="button" className="btn btn-green" onClick={openNewRequest}><Icons.add size={18} aria-hidden="true" /> New request</button>
        </>}
      />
      {payoutModeError && <PayoutModeError onRetry={reloadPayoutMode} />}
      {manual && <ManualModeBanner> Cash payouts are unchanged.</ManualModeBanner>}

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-lbl">Waiting for approval</div>
          {statVal(pending.length, 'amber')}
          <div className="stat-sub">{awaitingOtp ? `${awaitingOtp} need${awaitingOtp === 1 ? 's' : ''} a Paystack code` : 'Needs a super admin'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Codes issued today</div>
          {statVal(data?.tokensToday ?? 0)}
          <div className="stat-sub">Active and expired</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Approved</div>
          {statVal(data?.approved ?? 0)}
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Rejected</div>
          {statVal(data?.rejected ?? 0)}
          <div className="stat-sub">All time</div>
        </div>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Redemption views">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{t.count !== undefined && <span className="cm-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Waiting for approval */}
      {tab === 'pending' && (
        <section className="card" id="panel-pending" role="tabpanel" aria-labelledby="tab-pending">
          {loading && !data ? <TableSkeleton rows={6} cols={6} />
            : failed && !data ? <LoadError what="redemption requests" onRetry={load} />
            : pending.length === 0 ? (
              <Empty icon="check" title="Nothing waiting for approval" text="New redemption requests show here. You can also create one for a customer."
                action={<button type="button" className="btn btn-outline" onClick={openNewRequest}>New request</button>} />
            ) : (
              <>
                {failed && <p className="a-alert a-alert-a cm-gap" role="status">We couldn’t refresh this list. It may be out of date.</p>}
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead>
                      <tr>
                        <th>Request</th><th>Customer</th><th>Agent</th><th>Type</th>
                        <th className="num">Net payout</th><th>Payout method</th><th>Reason</th><th>Requested</th>
                        <th className="num td-pin-end">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map(r => (
                        <tr key={r.id} className="is-clickable" onClick={() => openRow(r)}>
                          <td className="cm-nowrap"><span className="cm-ref">{r.ref}</span></td>
                          <td data-label="Customer">
                            <div className="td-name">{r.customerName}</div>
                            <div className="td-sub">{r.customerId}</div>
                            {r.planGoal && <div className="td-sub">Plan: {r.planGoal}</div>}
                          </td>
                          <td data-label="Agent">
                            <div className="td-name">{r.agentName}</div>
                            <div className="td-sub">{r.agentId}</div>
                          </td>
                          <td data-label="Type"><TypeBadge type={r.type} /></td>
                          <td className="num cm-strong" data-label="Net payout">{nairaKobo(r.netPayout)}</td>
                          <td data-label="Payout method">
                            <div>{r.payoutMethod ?? 'Cash'}</div>
                            {isBank(r.payoutMethod) && r.bankName && <>
                              <div className="td-sub">{r.accountName}</div>
                              <div className="td-sub">{r.bankName} <span className="am-acct-sm">{last4(r.accountNumber)}</span></div>
                            </>}
                          </td>
                          <td data-label="Reason"><span className="cm-truncate cm-sub2" title={r.reason}>{r.reason}</span></td>
                          <td data-label="Requested" className="cm-nowrap cm-sub2">{dateTime(r.requestedAt)}</td>
                          <td className="td-pin-end">
                            <div className="cm-act">
                              <StatusBadge status={r.status} />{r.needsReview && <> <span className="bdg bdg-r">Needs review</span></>}
                              <div className="a-row-actions">{viewButton(r)}</div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
        </section>
      )}

      {/* Completed payouts */}
      {tab === 'completed' && (
        <div id="panel-completed" role="tabpanel" aria-labelledby="tab-completed">
          <div className="stats-grid">
            <div className="stat"><div className="stat-lbl">Payouts made</div><div className="stat-val">{completedStats ? completedStats.totalRedemptions.toLocaleString('en-NG') : '—'}</div><div className="stat-sub">All time</div></div>
            <div className="stat"><div className="stat-lbl">Total paid out</div><div className="stat-val">{completedStats ? nairaKobo(completedStats.totalRedeemedAmount) : '—'}</div><div className="stat-sub">All time</div></div>
            <div className="stat"><div className="stat-lbl">Payouts today</div><div className="stat-val">{completedStats ? completedStats.todayCount.toLocaleString('en-NG') : '—'}</div></div>
            <div className="stat"><div className="stat-lbl">Paid out today</div><div className="stat-val">{completedStats ? nairaKobo(completedStats.todayAmount) : '—'}</div></div>
          </div>

          <div className="toolbar">
            <SearchField value={completedSearch} onChange={setCompletedSearch} placeholder="Reference, customer or agent" label="Search completed payouts" />
            <label className="sr-only" htmlFor="cp-date">Payout date</label>
            <input id="cp-date" type="date" className="a-input cm-date" value={completedDate} onChange={e => setCompletedDate(e.target.value)} />
            {(completedSearch || completedDate) && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setCompletedSearch(''); setCompletedDate('') }}>Clear filters</button>}
          </div>

          <section className="card" aria-label="Completed payouts" aria-busy={completedLoading}>
            {completedLoading ? <TableSkeleton rows={6} cols={6} />
              : completedFailed ? <LoadError what="completed payouts" onRetry={loadCompleted} />
              : completed.length === 0 ? (
                completedQ || completedDate
                  ? <Empty icon="search" title="No payouts match" text="Try another date or search, or clear the filters." />
                  : <Empty icon="redeem" title="No payouts yet" text="Approved redemptions show here once the money is paid." />
              ) : (
                <>
                  <p className="cm-count">{completed.length.toLocaleString('en-NG')} payout{completed.length === 1 ? '' : 's'}</p>
                  <div className="tbl-wrap tbl-stack">
                    <table>
                      <thead>
                        <tr><th>Reference</th><th>Customer</th><th>Agent</th><th className="num">Amount</th><th>Method</th><th>Date</th><th>Status</th><th className="td-pin-end"><span className="sr-only">Actions</span></th></tr>
                      </thead>
                      <tbody>
                        {completed.slice((completedPage - 1) * PAGE_SIZE, completedPage * PAGE_SIZE).map(r => (
                          <tr key={r.id} className="is-clickable" onClick={() => { if (!window.getSelection()?.toString()) setCompletedDetail(r) }}>
                            <td><span className="cm-ref">{r.ref}</span></td>
                            <td data-label="Customer">
                              {r.customerName
                                ? <><div className="td-name">{r.customerName}</div><div className="td-sub">{r.customerId}</div></>
                                : <span className="cm-muted">—</span>}
                            </td>
                            <td data-label="Agent">
                              <div className="td-name">{r.agentName}</div>
                              <div className="td-sub">{r.agentId}</div>
                            </td>
                            <td className="num cm-strong" data-label="Amount">{nairaKobo(r.amount)}</td>
                            <td data-label="Method" className="cm-sub2">{r.method ?? '—'}</td>
                            <td data-label="Date" className="cm-nowrap cm-sub2">{dateTime(r.createdAt)}</td>
                            <td data-label="Status"><span className={`bdg ${r.status === 'Done' ? 'bdg-g' : 'bdg-a'}`}>{r.status === 'Done' ? 'Paid' : r.status}</span></td>
                            <td className="td-pin-end">
                              <div className="a-row-actions">
                                <button type="button" className="btn btn-sm btn-outline" onClick={() => setCompletedDetail(r)} aria-label={`View payout ${r.ref}`}>View</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={completedPage} pageSize={PAGE_SIZE} total={completed.length} onPage={setCompletedPage} />
                </>
              )}
          </section>
        </div>
      )}

      {/* All requests */}
      {tab === 'history' && (
        <div id="panel-history" role="tabpanel" aria-labelledby="tab-history">
          <div className="toolbar">
            <SearchField value={historySearch} onChange={setHistorySearch} placeholder="Customer, reference or agent" label="Search redemption requests" />
            <label className="sr-only" htmlFor="h-type">Redemption type</label>
            <select id="h-type" className="a-input cm-select" value={historyTypeFilter} onChange={e => setHistoryTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="early">Early exit</option>
              <option value="matured">After maturity</option>
            </select>
            <Segmented<HistoryStatus> label="Filter by decision" value={historyStatusFilter} onChange={setHistoryStatusFilter} options={[
              { value: 'all', label: 'All' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]} />
          </div>

          <section className="card" aria-label="All redemption requests">
            {loading && !data ? <TableSkeleton rows={6} cols={6} />
              : failed && !data ? <LoadError what="redemption requests" onRetry={load} />
              : history.length === 0 ? (
                historyFiltered
                  ? <Empty icon="search" title="No requests match" text="Try a different search or filter." />
                  : <Empty icon="history" title="No decided requests yet" text="Requests show here once they’re approved or rejected." />
              ) : (
                <>
                  <p className="cm-count">{history.length.toLocaleString('en-NG')} request{history.length === 1 ? '' : 's'}</p>
                  <div className="tbl-wrap tbl-stack">
                    <table>
                      <thead>
                        <tr>
                          <th>Request</th><th>Customer</th><th>Agent</th><th>Type</th><th className="num">Balance</th>
                          <th className="num">Fee</th><th className="num">Net payout</th><th>Decision</th><th>Decided by</th><th>Date</th><th className="td-pin-end"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE).map(r => (
                          <tr key={r.id} className="is-clickable" onClick={() => openRow(r)}>
                            <td className="cm-nowrap"><span className="cm-ref">{r.ref}</span></td>
                            <td data-label="Customer"><div className="td-name">{r.customerName}</div><div className="td-sub">{r.customerId}</div></td>
                            <td data-label="Agent"><div className="td-name">{r.agentName}</div><div className="td-sub">{r.agentId}</div></td>
                            <td data-label="Type"><TypeBadge type={r.type} /></td>
                            <td className="num" data-label="Balance">{nairaKobo(r.balance)}</td>
                            <td className="num cm-sub2" data-label="Fee">{r.penalty > 0 ? nairaKobo(r.penalty) : '—'}</td>
                            <td className="num cm-strong" data-label="Net payout">{nairaKobo(r.netPayout)}</td>
                            <td data-label="Decision"><StatusBadge status={r.status} />{r.needsReview && <> <span className="bdg bdg-r">Needs review</span></>}</td>
                            <td data-label="Decided by" className="cm-sub2">{r.decidedBy ?? '—'}</td>
                            <td data-label="Date" className="cm-nowrap cm-sub2">{r.decidedAt ? dateTime(r.decidedAt) : '—'}</td>
                            <td className="td-pin-end"><div className="a-row-actions">{viewButton(r)}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={historyPage} pageSize={PAGE_SIZE} total={history.length} onPage={setHistoryPage} />
                </>
              )}
          </section>
        </div>
      )}

      {/* New request */}
      {showModal && (
        <Modal error={createError || undefined} icon="redeem" title="New redemption request" sub="For a customer who wants their savings out." onClose={() => setShowModal(false)} busy={submitting}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={submitting || plansLoading} onClick={handleSubmit}>{submitting ? 'Creating…' : 'Create request'}</button>
          </>}>
          <div className="cm-info is-amber">
            <Icons.locked size={16} aria-hidden="true" />
            <span>A one-time security code is created with the request. It must be validated before the payout can be approved. The savings fee is taken from the balance; there’s no extra early-exit penalty.</span>
          </div>

          {plansFailed ? (
            <div className="cm-gap">
              <p className="a-alert a-alert-r" role="alert">We couldn’t load active savings plans.</p>
              <button type="button" className="btn btn-outline btn-sm cm-gap" onClick={loadPlans}><Icons.retry size={16} aria-hidden="true" /> Try again</button>
            </div>
          ) : (
            <Field id="nr-plan" label="Customer and plan" error={formErrors.plan}
              hint={plansLoading ? 'Loading active plans…' : plans.length >= PLAN_LIMIT ? `Showing the ${PLAN_LIMIT} newest active plans.` : plans.length === 0 ? 'There are no active plans to redeem.' : undefined}>
              <select id="nr-plan" className="a-input" value={form.savingsPlanId} disabled={plansLoading} aria-invalid={!!formErrors.plan}
                onChange={e => onFormChange('savingsPlanId', e.target.value)}>
                <option value="">{plansLoading ? 'Loading…' : 'Choose a customer'}</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.customerName} ({p.customerId}) · {nairaKobo(p.balance)}</option>
                ))}
              </select>
            </Field>
          )}

          <Field id="nr-type" label="Redemption type">
            <select id="nr-type" className="a-input" value={form.type} onChange={e => onFormChange('type', e.target.value)}>
              <option value="early">Early exit (before maturity)</option>
              <option value="matured">After maturity</option>
            </select>
          </Field>

          <Field id="nr-reason" label="Reason" error={formErrors.reason}>
            <select id="nr-reason" className="a-input" value={form.reason} aria-invalid={!!formErrors.reason} onChange={e => onFormChange('reason', e.target.value)}>
              <option value="">Choose a reason</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          {(form.reason === 'Other (see note)' || form.note) && (
            <Field id="nr-note" label="Note" hint="Only admins and the agent see this.">
              <textarea id="nr-note" className="a-input" rows={2} placeholder="Say a little more about why" value={form.note} onChange={e => onFormChange('note', e.target.value)} />
            </Field>
          )}

          {preview && (
            <div className="dlg-hero">
              <h3 className="cm-sec-title">Payout estimate</h3>
              <dl className="dlg-ledger">
                <DlRow label="Plan balance">{nairaKobo(preview.balance)}</DlRow>
                {preview.savingsFee > 0 && <DlRow label="Savings fee"><span className="cm-neg">−{nairaKobo(preview.savingsFee)}</span></DlRow>}
                <DlRow label="Net payout to customer" total>{nairaKobo(preview.netPayout)}</DlRow>
              </dl>
              <p className="a-hint">The exact amount is worked out when you create the request. If the fee is waived for this plan, the customer gets the full balance.</p>
            </div>
          )}

        </Modal>
      )}

      {/* Approve: review + PIN */}
      {pinModal && (
        <Modal error={approveError || undefined} icon="redeem" tone="money" title={manual && isBank(pinModal.payoutMethod) ? 'Mark payout as paid' : 'Approve payout'} sub={`${pinModal.ref}`} onClose={() => { setPinModal(null); setPinValue(''); setPinError(''); setApproveError(''); setTransferRef('') }} busy={pinLoading}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => { setPinModal(null); setPinValue(''); setPinError(''); setApproveError(''); setTransferRef('') }} disabled={pinLoading}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={pinLoading || !pinValue} onClick={confirmApprove}>
              {pinLoading ? ((manual && isBank(pinModal.payoutMethod)) ? 'Saving…' : 'Approving…') : (manual && isBank(pinModal.payoutMethod)) ? `Mark ${nairaKobo(pinModal.amount)} as paid` : `Approve ${nairaKobo(pinModal.amount)}`}
            </button>
          </>}>
          <div className="dlg-hero">
            <div className="dlg-hero-lbl">Net payout</div>
            <div className="dlg-hero-amt">{nairaKobo(pinModal.amount)}</div>
            <div className="dlg-hero-sub">To <strong>{pinModal.customerName}</strong> ({pinModal.customerId})</div>
            {isBank(pinModal.payoutMethod) && pinModal.bankName ? (
              <div className="dlg-hero-extra">
                <span className="dlg-hero-lbl">{(manual && isBank(pinModal.payoutMethod)) ? 'Bank transfer (you pay)' : 'Paystack bank transfer'}</span>
                <strong>{pinModal.accountName}</strong>
                <span>{pinModal.bankName}</span>
                <span className="am-acct">{pinModal.accountNumber ?? '—'}</span>
              </div>
            ) : (
              <div className="dlg-hero-extra"><span className="dlg-hero-lbl">Payout method</span><strong>{pinModal.payoutMethod}</strong></div>
            )}
          </div>
          {isBank(pinModal.payoutMethod) && pinModal.bankName && <p className="a-hint cm-gap">The account name is what was typed, not checked with the bank. Compare it with the name your bank app shows before you pay.</p>}
          {pinModal.nameMismatch && <p className="a-alert a-alert-r cm-gap" role="alert">The names don’t match. Customer: <strong>{pinModal.customerName}</strong>. Name on the account: <strong>{pinModal.accountName ?? '—'}</strong>. Your PIN confirms you’ve checked this, and it’s recorded.</p>}
          <p className="a-hint cm-gap">
            {(manual && isBank(pinModal.payoutMethod))
              ? 'Paystack is bypassed. Only confirm after you have paid this customer’s bank account yourself. The plan closes when you confirm.'
              : isBank(pinModal.payoutMethod)
              ? 'Paystack sends the money as soon as you approve. Paystack may text a code to your admin phone to release it.'
              : 'The agent pays the customer in cash, and their wallet is credited back with this amount. The customer’s plan closes.'}
          </p>
          <form onSubmit={e => { e.preventDefault(); confirmApprove() }} noValidate>
            {manual && isBank(pinModal.payoutMethod) && (
              <Field id="ap-ref" label="Transfer reference (optional)" hint="Your bank transfer reference. It is saved with the payout.">
                <input id="ap-ref" className="a-input" type="text" maxLength={120} autoComplete="off"
                  value={transferRef} onChange={e => setTransferRef(e.target.value)} />
              </Field>
            )}
            <Field id="ap-pin" label="Your approval PIN" error={pinError}>
              <input id="ap-pin" className="a-input cm-code" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                value={pinValue} aria-invalid={!!pinError} placeholder="••••"
                onChange={e => { setPinValue(e.target.value); setPinError('') }} />
            </Field>
          </form>
        </Modal>
      )}

      {/* Paystack OTP */}
      {otpModal && (
        <Modal icon="locked" tone="money" title="Finish the Paystack transfer" sub={`${otpModal.customerName} · ${otpModal.ref}`}
          onClose={() => { setOtpModal(null); setOtpValue('') }} busy={otpLoading}
          footer={<>
            <button type="button" className="btn btn-outline" disabled={otpLoading} onClick={() => { setOtpModal(null); setOtpValue('') }}>Later</button>
            <button type="button" className="btn btn-green" disabled={otpLoading || otpValue.length < 4} onClick={submitOtp}>
              {otpLoading ? 'Sending…' : 'Complete transfer'}
            </button>
          </>}>
          <p className="a-confirm-body cm-gap">Paystack needs a one-time code to release this transfer. Check the text message on your registered admin phone and enter the 6-digit code.</p>
          <form onSubmit={e => { e.preventDefault(); submitOtp() }} noValidate>
            <Field id="otp-code" label="Paystack code" error={otpError} hint="If you close this, you can enter the code later from the list.">
              <input id="otp-code" className="a-input cm-code" type="tel" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={otpValue} aria-invalid={!!otpError} placeholder="000000"
                onChange={e => { setOtpValue(digitsOnly(e.target.value).slice(0, 6)); setOtpError('') }} />
            </Field>
          </form>
        </Modal>
      )}

      {/* Reject */}
      {rejectTarget && (
        <ConfirmModal
          title={`Reject ${rejectTarget.ref}?`}
          body={<>
            {rejectTarget.customerName} ({rejectTarget.customerId}) won’t receive the {nairaKobo(rejectTarget.netPayout)} payout.
            Their plan goes back to active with its {nairaKobo(rejectTarget.status === 'AwaitingOTP' && rejectTarget.planStatus === 'Redeemed' ? rejectTarget.currentBalance + rejectTarget.balance : rejectTarget.currentBalance)} balance. No money moves.
          </>}
          confirmLabel="Reject request" danger
          busy={rejectBusy} error={rejectError}
          onConfirm={confirmReject} onClose={() => setRejectTarget(null)}
        />
      )}

      {/* Completed payout details */}
      {completedDetail && (
        <Modal icon="redeem" title={completedDetail.ref} sub="Completed payout" onClose={() => setCompletedDetail(null)}
          footer={<button type="button" className="btn btn-outline" onClick={() => setCompletedDetail(null)}>Close</button>}>
          <div className="dlg-hero">
            <div className="dlg-hero-lbl">Amount paid</div>
            <div className="dlg-hero-amt">{nairaKobo(completedDetail.amount)}</div>
            <span className="cm-badges"><span className={`bdg ${completedDetail.status === 'Done' ? 'bdg-g' : 'bdg-a'}`}>{completedDetail.status === 'Done' ? 'Paid' : completedDetail.status}</span></span>
          </div>
          <div className="cm-sec">
            <h3 className="cm-sec-title">Customer</h3>
            <dl className="dlg-ledger">
              <DlRow label="Name">{completedDetail.customerName ?? '—'}</DlRow>
              <DlRow label="Customer ID">{completedDetail.customerId ?? '—'}</DlRow>
              <DlRow label="Agent">{completedDetail.agentName} ({completedDetail.agentId})</DlRow>
            </dl>
          </div>
          <div className="cm-sec">
            <h3 className="cm-sec-title">Payout</h3>
            <dl className="dlg-ledger">
              <DlRow label="Method">{completedDetail.method ?? '—'}</DlRow>
              <DlRow label="Date">{dateTime(completedDetail.createdAt)}</DlRow>
              <DlRow label="Reference"><span className="cm-ref">{completedDetail.ref}</span></DlRow>
            </dl>
          </div>
        </Modal>
      )}

      {/* Details */}
      {detail && (
        <Modal icon="redeem" title={detail.ref} sub="Redemption request" onClose={() => setDetail(null)}
          footer={DECIDABLE.includes(detail.status) ? <>
            <button type="button" className="btn btn-outline" onClick={() => { const r = detail; setDetail(null); openReject(r) }}>Reject</button>
            {!needsCode(detail) && !detail.balanceChanged && !cashBlocked(detail) && <button type="button" className="btn btn-green" onClick={() => { const r = detail; setDetail(null); openApprove(r) }}>{detail.nameMismatch ? 'Review and approve anyway' : manual && isBank(detail.payoutMethod) ? 'Mark as paid' : 'Approve'}</button>}
          </> : detail.status === 'AwaitingOTP' ? <>
            <button type="button" className="btn btn-outline" onClick={() => { const r = detail; setDetail(null); openReject(r) }}>Reject</button>
            <button type="button" className="btn btn-outline" disabled={checking} onClick={() => checkWithPaystack(detail)}>{checking ? 'Checking…' : 'Check with Paystack'}</button>
            {!detail.balanceChanged && <button type="button" className="btn btn-green" onClick={() => { const r = detail; setDetail(null); setOtpValue(''); setOtpError(''); setOtpModal({ id: r.id, ref: r.ref, customerName: r.customerName, amount: r.netPayout }) }}>Enter Paystack code</button>}
          </> : detail.status === 'Processing' || detail.status === 'Finalizing' ? <>
            <button type="button" className="btn btn-outline" disabled={checking} onClick={() => setDetail(null)}>Close</button>
            <button type="button" className="btn btn-green" disabled={checking} onClick={() => checkWithPaystack(detail)}>{checking ? 'Checking…' : 'Check with Paystack'}</button>
          </> : <button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>Close</button>}>
          {detail.balanceChanged && (detail.status === 'AwaitingOTP'
            ? <p className="a-alert a-alert-r cm-gap" role="alert">This plan now holds {nairaKobo(detail.currentBalance)}, which arrived while this payout was waiting for its code. Nothing has been paid. Don’t enter the code. Once it expires, about 30 minutes after it was sent, use Check with Paystack and ask them to request again.</p>
            : <p className="a-alert a-alert-r cm-gap" role="alert">The balance has changed. They asked to redeem from {nairaKobo(detail.balance)}, and the plan now holds {nairaKobo(detail.currentBalance)}. Reject this request and ask them to request again.</p>)}
          {cashBlocked(detail) && DECIDABLE.includes(detail.status) && <p className="a-alert a-alert-r cm-gap" role="alert">This customer’s agent isn’t active, so cash can’t be paid through them. Reject this request and ask the customer to request again with a bank account.</p>}
          {detail.nameMismatch && DECIDABLE.includes(detail.status) && (
            <div className="a-alert a-alert-r cm-gap" role="alert">
              <strong>Held: the names don’t match.</strong> An agent asked to pay this to an account in another name.
              <dl className="dlg-ledger">
                <DlRow label="Customer">{detail.customerName}</DlRow>
                <DlRow label="Name on the account">{detail.accountName ?? '—'}</DlRow>
              </dl>
            </div>
          )}
          {needsCode(detail) && <p className="a-alert a-alert-a cm-gap" role="status">The customer hasn’t confirmed this request with their code, so it can’t be approved yet. You can reject it.</p>}
          {(detail.status === 'Processing' || detail.status === 'Finalizing') && (UNCLEAR_FINAL.includes(detail.bankTransferStatus ?? '')
            ? <p className="a-alert a-alert-r cm-gap" role="alert">Paystack says “{detail.bankTransferStatus}”. That’s final, but it doesn’t say whether money moved, so this hasn’t been recorded or released. Check the Paystack dashboard.</p>
            : <p className="a-alert a-alert-a cm-gap" role="status">{detail.bankTransferStatus ? `Paystack last said “${detail.bankTransferStatus}”. ` : 'We lost contact with Paystack during this transfer. '}It may or may not have gone out, so check before doing anything else.</p>)}
          {detail.needsReview && <p className="a-alert a-alert-r cm-gap" role="alert">Needs review. This was paid, but the closed plan still holds {nairaKobo(detail.currentBalance)} that arrived during the payout.</p>}
          <div className="dlg-hero">
            <div className="dlg-hero-lbl">Amount to redeem</div>
            <div className="dlg-hero-amt">{nairaKobo(detail.netPayout)}</div>
            <span className="cm-badges"><StatusBadge status={detail.status} /><TypeBadge type={detail.type} /></span>
          </div>

          {isBank(detail.payoutMethod) && detail.bankName && (
            <div className="cm-sec">
              <h3 className="cm-sec-title">Pay to</h3>
              <dl className="dlg-ledger">
                <DlRow label="Account number"><span className="am-acct">{detail.accountNumber ?? '—'}</span></DlRow>
                <DlRow label="Account name">{detail.accountName ?? '—'}</DlRow>
                <DlRow label="Bank">{detail.bankName}</DlRow>
                {detail.bankTransferStatus && <DlRow label="Transfer status">{detail.bankTransferStatus}</DlRow>}
              </dl>
            </div>
          )}

          <div className="cm-sec">
            <h3 className="cm-sec-title">Customer</h3>
            <dl className="dlg-ledger">
              <DlRow label="Name">{detail.customerName}</DlRow>
              <DlRow label="Customer ID">{detail.customerId}</DlRow>
              {detail.customerPhone && <DlRow label="Phone"><span className="cm-ref">{detail.customerPhone}</span></DlRow>}
              <DlRow label="Agent">{detail.agentName} ({detail.agentId})</DlRow>
            </dl>
          </div>

          {detail.planGoal && (
            <div className="cm-sec">
              <h3 className="cm-sec-title">Plan being redeemed</h3>
              <dl className="dlg-ledger">
                <DlRow label="Plan">{detail.planGoal}</DlRow>
                {detail.planStartDate && <DlRow label="Started">{shortDate(detail.planStartDate)}</DlRow>}
                {detail.planMaturityDate && <DlRow label="Matures">{shortDate(detail.planMaturityDate)}</DlRow>}
                <DlRow label="Plan status">{detail.planStatus}</DlRow>
              </dl>
            </div>
          )}

          <div className="cm-sec">
            <h3 className="cm-sec-title">Payout</h3>
            <dl className="dlg-ledger">
              <DlRow label="Plan balance">{nairaKobo(detail.balance)}</DlRow>
              {detail.penalty > 0 && <DlRow label="Fee deducted (commission)"><span className="cm-neg">−{nairaKobo(detail.penalty)}</span></DlRow>}
              <DlRow label="Amount to redeem" total>{nairaKobo(detail.netPayout)}</DlRow>
              <DlRow label="Method">{detail.payoutMethod ?? 'Cash'}</DlRow>
            </dl>
          </div>

          {detail.customerPlans && detail.customerPlans.length > 0 && (
            <div className="cm-sec">
              <h3 className="cm-sec-title">All savings plans ({detail.customerPlans.length})</h3>
              <dl className="dlg-ledger">
                {detail.customerPlans.map(p => (
                  <DlRow key={p.id} label={p.id === detail.savingsPlanId ? `${p.goal} — redeeming now` : p.goal}>
                    {nairaKobo(p.balance)} · {p.status} · matures {shortDate(p.maturityDate)}
                  </DlRow>
                ))}
              </dl>
            </div>
          )}

          {(detail.token || detail.tokenExpiry) && (
            <div className="cm-sec">
              <h3 className="cm-sec-title">Security code</h3>
              <dl className="dlg-ledger">
                {detail.token && <DlRow label="Code"><span className="cm-ref">{detail.token}</span></DlRow>}
                <DlRow label="Expires">{detail.tokenExpiry ? dateTime(detail.tokenExpiry) : '—'}</DlRow>
              </dl>
            </div>
          )}

          <div className="cm-sec">
            <h3 className="cm-sec-title">Reason</h3>
            <p className="cm-note-text">{detail.reason}</p>
            {detail.note && <p className="cm-note-text">{detail.note}</p>}
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Timeline</h3>
            <dl className="dlg-ledger">
              <DlRow label="Requested">{dateTime(detail.requestedAt)}</DlRow>
              {detail.decidedAt && <DlRow label="Decided">{dateTime(detail.decidedAt)}</DlRow>}
              {detail.decidedBy && <DlRow label="Decided by">{detail.decidedBy}</DlRow>}
            </dl>
          </div>
        </Modal>
      )}

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {toastNode}
    </>
  )
}
