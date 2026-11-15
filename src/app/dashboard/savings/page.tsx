'use client'

import { planFeePreview } from '@/lib/savings-fee'
import { usePlanFees } from '@/lib/use-plan-fees'
import { useFlexibleTerms } from '@/lib/use-flexible-terms'
import { isFlexible } from '@/lib/flexible-savings'
import { isOpenForSaving } from '@/lib/plan-credit'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { avatarTint } from '@/lib/avatar'
import { waLink } from '@/lib/whatsapp'
import { displayName, formatDate, formatNaira, formatTime } from '@/lib/format'
import { buildSlots, dateKey, periodAlreadySaved, periodWord, slotKeyForDate } from '@/lib/savings-card'
import { addDays, isoDate, parseDateInput, today } from '@/lib/plan-dates'
import { createReceiptSender, SEND_IDLE } from '@/lib/receipt-send'
import BottomSheet from '@/components/ui/BottomSheet'
import ReopenCodeSheet from '@/components/ui/ReopenCodeSheet'
import EmptyState from '@/components/ui/EmptyState'
import DatePicker from '@/components/ui/DatePicker'
import EndDateField, { endDateDays } from '@/components/ui/EndDateField'
import { FormError } from '@/components/ui/FormErrors'
import PinPad from '@/components/ui/PinPad'
import { SendReceiptButton, SendReceiptNotices } from '@/components/ui/SendReceipt'
import ListRow from '@/components/ui/ListRow'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import RetakePhotoSheet from '@/components/agent/RetakePhotoSheet'
import PhotoButtons from '@/components/agent/PhotoButtons'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; planDays: number | null; planId: string | null
  planStatus: string | null; dailyAmount: number | null; photoUrl?: string | null
  /** Photo deadline: after it, saving for anyone without an approved photo is paused. */
  photoStatus?: 'ok' | 'missing' | 'pending' | 'rejected'
  savingsPlans?: SavingsPlan[]
  /** online = registered themselves and opens their own plans; the server refuses agents too. */
  type?: 'online' | 'offline'
}
/** `dailyAmount` is stored as a per-day equivalent; weekly / monthly plans pay 7 or 30 times that each time. */
interface SavingsPlan { id: string; goal: string; status: string; startDate?: string | null; maturityDate: string | null; dailyAmount: number; cadence?: string | null; balance: number; periodDays: number; source?: string | null }
const UNIT_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 }
const perPayment = (p: SavingsPlan) => Math.round(p.dailyAmount * (UNIT_DAYS[p.cadence ?? 'daily'] ?? 1) * 100) / 100
const planUnit = (p: SavingsPlan) => p.cadence === 'weekly' ? 'week' : p.cadence === 'monthly' ? 'month' : 'day'

interface TodaySaving { name: string; time: string; method: string; amount: number }
interface RecentCustomer { code: string; name: string; photoUrl?: string | null }
interface PaidToday { planId: string | null; amount: number; time: string; createdAt: string }

type Receipt = {
  ref: string; customer: string; customerId: string; phone: string; amount: number; balance: number
  method: string; agent: string; date: string; goal?: string; maturityDate?: string; inviteUrl?: string
}

type Cadence = 'daily' | 'weekly' | 'monthly'
// `endDate` is a chosen end date ("yyyy-mm-dd") instead of a set length; only `periodDays` is sent.
const EMPTY_PLAN = { dailyAmount: '', periodDays: '90', goal: '', startDate: '', endDate: '', cadence: 'daily' as Cadence }

const PERIODS: Record<Cadence, [string, string][]> = {
  daily: [['31', '31 days'], ['62', '62 days'], ['90', '90 days'], ['180', '180 days'], ['365', '365 days']],
  weekly: [['28', '4 weeks'], ['56', '8 weeks'], ['84', '12 weeks'], ['168', '24 weeks'], ['364', '52 weeks']],
  monthly: [['30', '1 month'], ['60', '2 months'], ['90', '3 months'], ['180', '6 months'], ['365', '12 months']],
}

export default function SavingsPage() {
  return <Suspense><SavingsContent /></Suspense>
}

function maskPhone(p: string) {
  if (!p || p.length < 7) return p
  return p.slice(0, 4) + '****' + p.slice(-3)
}

function whatsAppLink(phone: string, r: Receipt, days: number) {
  const lines = [
    'Vochus Easy Save — saving received',
    `${formatNaira(r.amount)} for ${displayName(r.customer)}${days > 1 ? ` (${days} days)` : ''}`,
    `New balance: ${formatNaira(r.balance)}`,
    r.goal ? `Plan: ${r.goal}` : '',
    `Date: ${r.date}`,
    `Reference: ${r.ref}`,
    r.agent ? `Recorded by: ${r.agent}` : '',
  ].filter(Boolean)
  return waLink(phone, lines.join('\n'))
}

function CustomerAvatar({ c }: { c: Pick<Customer, 'firstName' | 'lastName' | 'photoUrl'> }) {
  return c.photoUrl
    ? <img src={c.photoUrl} className="ui-avatar" alt="" />
    : <span className="ui-avatar" aria-hidden="true">{c.firstName[0]}{c.lastName[0]}</span>
}

function SavingsContent() {
  const { update, data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [searchedFor, setSearchedFor] = useState('')
  const [searchFailed, setSearchFailed] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  /** The plan this saving goes into. Picked automatically when the customer has one active plan. */
  const [planId, setPlanId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const flexTerms = useFlexibleTerms()
  const [method] = useState('Cash')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [todaySavings, setTodaySavings] = useState<TodaySaving[] | null>(null)
  const [todayTotal, setTodayTotal] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [newPlan, setNewPlan] = useState(EMPTY_PLAN)

  const [hasPin, setHasPin] = useState(true)
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null)
  const [lastDays, setLastDays] = useState(1)
  const [lastPhone, setLastPhone] = useState('')
  // Kept apart from lastReceipt, which is posted as-is to the app's receipt printer.
  const [lastTxIds, setLastTxIds] = useState<string[]>([])
  const [send, setSend] = useState(SEND_IDLE)
  const [sender] = useState(() => createReceiptSender(setSend))
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [recent, setRecent] = useState<RecentCustomer[]>([])
  const [paidToday, setPaidToday] = useState<PaidToday[] | null>(null)
  const recordDate = searchParams.get('date') ?? null

  // Bulk payment
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [paidDates, setPaidDates] = useState<string[]>([])
  // Online plans price and pick by slot, from the server's calendar. Null for offline plans.
  const [onlineCal, setOnlineCal] = useState<OnlineCalendar | null>(null)
  const [planStartDate, setPlanStartDate] = useState<string | null>(null)
  /** Last day the plan runs (yyyy-mm-dd); days after it can't be picked. */
  const [planLastDate, setPlanLastDate] = useState<string | null>(null)
  const [paidDatesLoading, setPaidDatesLoading] = useState(false)
  const [calendarView, setCalendarView] = useState<{ year: number; month: number }>(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }
  })

  // PIN
  const [pinModal, setPinModal] = useState(false)
  const [noPinModal, setNoPinModal] = useState(false)
  const [pinEntry, setPinEntry] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinVerifying, setPinVerifying] = useState(false)

  useEffect(() => {
    fetch('/api/agent').then(r => r.json()).then(d => {
      setHasPin(!!d.agent?.hasPin)
      if (typeof d.agent?.walletBalance === 'number') setWalletBalance(d.agent.walletBalance)
    }).catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    if (!planId) { setPlanStartDate(null); setPlanLastDate(null); setPaidDates([]); setSelectedDates([]); setOnlineCal(null) }
    if (!bulkMode || !planId) return
    setPaidDatesLoading(true)
    const n = new Date()
    setCalendarView({ year: n.getFullYear(), month: n.getMonth() })
    fetch(`/api/transactions/saving/bulk?planId=${planId}`)
      .then(r => r.json())
      .then(async (cal: { online?: boolean } & Partial<OnlineCalendar>) => {
        setSelectedDates([])
        if (cal.online) {
          const online = cal as OnlineCalendar
          setOnlineCal(online)
          setPaidDates(online.slots.filter(s => s.state === 'saved').map(s => s.key))
          setPlanStartDate(online.slots[0]?.key ?? null)
          setPlanLastDate(online.slots[online.slots.length - 1]?.key ?? null)
          return
        }
        setOnlineCal(null)
        const d = await fetch(`/api/transactions/saving/paid-dates?planId=${planId}`).then(r => r.json())
        setPaidDates(d.paidDates ?? [])
        setPlanStartDate(d.planStartDate ?? null)
        setPlanLastDate(d.planLastDate ?? null)
      })
      .catch(() => { setPlanStartDate(null); setPlanLastDate(null) })
      .finally(() => setPaidDatesLoading(false))
  }, [bulkMode, planId])

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid) return
    fetch(`/api/customers?search=${encodeURIComponent(cid)}&limit=1`)
      .then(r => r.json())
      .then(d => {
        const c = d.customers?.[0]
        if (c) { setSelected(c); setQuery(`${c.firstName} ${c.lastName}`) }
      })
      .catch(() => {})
  }, [searchParams])

  // Deep-link from the habit calendar's "Catch up or pay ahead" action lands straight in the
  // several-days (bulk) picker, so agents don't have to find the toggle themselves.
  useEffect(() => {
    if (searchParams.get('bulk') === '1') setBulkMode(true)
  }, [searchParams])

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) { setResults([]); setSearchedFor(''); setSearchFailed(false); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=5`)
      const data = await res.json()
      setResults(data.customers ?? [])
      setSearchFailed(false)
    } catch {
      setResults([])
      setSearchFailed(true)
    }
    setSearchedFor(q)
    setSearching(false)
  }, [query])

  useEffect(() => {
    if (selected) return
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [search, selected])

  // Only plans still open for saving (Active and before their end date). Ended ones are offered as Roll over above.
  const activePlans = (selected?.savingsPlans ?? []).filter(p => isOpenForSaving(p))
  const plan = activePlans.find(p => p.id === planId) ?? null
  /** Flexible plan: any amount the agent types, as often as the customer pays; no Bulk Savings, no one-a-day rule. */
  const flexPlan = !!plan && isFlexible(plan.cadence)
  const choosePlan = activePlans.length > 1

  // A new customer: pick their plan if there's only one, otherwise make the agent choose.
  useEffect(() => {
    const active = (selected?.savingsPlans ?? []).filter(p => isOpenForSaving(p))
    setPlanId(active.length === 1 ? active[0].id : null)
  }, [selected])

  // The amount is the chosen plan's agreed payment (per day, week or month).
  useEffect(() => {
    setAmount(plan && !isFlexible(plan.cadence) ? String(perPayment(plan)) : '')
    if (plan && isFlexible(plan.cadence)) setBulkMode(false)
  }, [plan?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/transactions?type=saving')
      .then(r => r.json())
      .then(d => {
        setTodayTotal(d.stats?.todaySavings ?? 0)
        const today = d.transactions?.filter((t: { createdAt: string }) => {
          const d2 = new Date(t.createdAt)
          const now = new Date()
          return d2.toDateString() === now.toDateString()
        }).slice(0, 5).map((t: { customer?: { name?: string; firstName?: string; lastName?: string }; createdAt: string; method?: string; amount: number }) => ({
          name: t.customer?.name ?? (t.customer ? `${t.customer.firstName ?? ''} ${t.customer.lastName ?? ''}`.trim() : '—'),
          time: formatTime(t.createdAt),
          method: t.method ?? 'Cash',
          amount: t.amount,
        })) ?? []
        setTodaySavings(today)
        // People this agent recorded most recently, for one-tap selection.
        const seen = new Set<string>()
        const rec: RecentCustomer[] = []
        for (const t of (d.transactions ?? []) as { customer?: { customerId?: string; name?: string } }[]) {
          const c = t.customer
          if (!c?.customerId || !c.name || seen.has(c.customerId)) continue
          seen.add(c.customerId)
          rec.push({ code: c.customerId, name: c.name })
          if (rec.length === 5) break
        }
        setRecent(rec)
      })
      .catch(() => setTodaySavings(prev => prev ?? []))
  }, [refreshKey])

  // This customer's latest savings, newest first: has the chosen plan already been paid for this period?
  useEffect(() => {
    setPaidToday(null)
    if (!selected || recordDate) return
    let live = true
    fetch(`/api/transactions?type=saving&customerId=${selected.id}&limit=30`)
      .then(r => r.json())
      .then(d => {
        if (!live) return
        setPaidToday(((d.transactions ?? []) as { planId: string | null; amount: number; createdAt: string }[])
          .map(t => ({ planId: t.planId, amount: t.amount, time: formatTime(t.createdAt), createdAt: t.createdAt })))
      })
      .catch(() => { if (live) setPaidToday([]) })
    return () => { live = false }
  }, [selected, recordDate])

  async function chooseRecent(code: string) {
    setError('')
    try {
      const d = await fetch(`/api/customers?search=${encodeURIComponent(code)}&limit=1`).then(r => r.json())
      const c = d.customers?.[0]
      if (c) choose(c)
      else setError('Couldn’t open that customer. Try searching instead.')
    } catch {
      setError('No connection. Check your internet and try again.')
    }
  }

  // Photo deadline: whether saving is paused yet, and anyone the server has refused for it during this visit.
  const [photoPhaseNow, setPhotoPhaseNow] = useState<string>('none')
  const [photoRefused, setPhotoRefused] = useState<Set<string>>(new Set())
  const [photoFor, setPhotoFor] = useState<Customer | null>(null)
  const [photoStart, setPhotoStart] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/agent/photo-reminder', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then((d: { phase?: string } | null) => { if (d?.phase) setPhotoPhaseNow(d.phase) }).catch(() => {})
  }, [])
  const selPaused = !!selected && (photoRefused.has(selected.id) || (photoPhaseNow === 'paused' && !!selected.photoStatus && selected.photoStatus !== 'ok'))

  function choose(c: Customer) {
    setSelected(c); setResults([]); setQuery(`${c.firstName} ${c.lastName}`); setError('')
  }

  function reset() {
    setSelected(null); setQuery(''); setAmount(''); setResults([]); setSearchedFor('')
    setBulkMode(false); setSelectedDates([]); setNewPlan(EMPTY_PLAN); setError(''); setPlanId(null)
  }

  function changeCustomer() {
    reset()
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  async function createPlan() {
    if (!selected) return
    if (!newPlan.dailyAmount || !newPlan.goal) { setError('Enter the amount and what the customer is saving for.'); return }
    if (!newPlan.periodDays) { setError('Choose how long the plan runs, or pick a valid end date.'); return }
    setLoading(true); setError('')
    const rawAmt = parseFloat(newPlan.dailyAmount)
    const isWeekly = newPlan.cadence === 'weekly'
    const isMonthly = newPlan.cadence === 'monthly'
    const dailyEquiv = isWeekly ? rawAmt / 7 : isMonthly ? rawAmt / 30 : rawAmt
    try {
      const res = await fetch('/api/customers/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selected.id,
          dailyAmount: String(dailyEquiv),
          periodDays: newPlan.periodDays,
          goal: newPlan.goal,
          cadence: newPlan.cadence,
          startDate: newPlan.startDate || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The plan could not be created. Please try again.'); setLoading(false); return }
    } catch {
      setError('No connection. Check your internet and try again.'); setLoading(false); return
    }
    setToast(`New savings plan created for ${selected.firstName} ${selected.lastName}`)
    reset()
    setLoading(false)
    setRefreshKey(k => k + 1)
    update()
  }

  // Matured or collected plans can be reopened, but only once the customer has read the code texted to them to the agent.
  const [reopenFor, setReopenFor] = useState<{ id: string; name: string; kind: 'rollover' | 'again'; rollover?: { balance: number; periodDays: number } } | null>(null)
  function reopenDone() {
    if (!selected) return
    const kind = reopenFor?.kind
    setReopenFor(null)
    setToast(kind === 'rollover' ? `Rolled over for ${selected.firstName}. The money stays and a new term has started.` : `Plan reopened for ${selected.firstName} ${selected.lastName}`)
    reset()
    setRefreshKey(k => k + 1)
    update()
  }

  function requestPin() {
    if (!selected) { setError('Choose a customer first.'); return }
    if (!plan) { setError(choosePlan ? 'Choose which plan this saving goes into.' : 'This customer has no active plan.'); return }
    if (flexPlan && !(parseFloat(amount) >= flexTerms.minDeposit && parseFloat(amount) > 0)) { setError(`Enter how much they’re paying (at least ${formatNaira(Math.max(flexTerms.minDeposit, 1), { minor: false })}).`); return }
    if (!bulkMode && (!amount || parseFloat(amount) <= 0)) { setError('This customer has no agreed amount on their plan.'); return }
    if (bulkMode && (!plan.dailyAmount || selectedDates.length < 1)) { setError('Tap at least one day on the calendar.'); return }
    setError('')
    if (!hasPin) { setNoPinModal(true); return }
    setPinEntry(''); setPinError(''); setPinModal(true)
  }

  async function confirmPin() {
    if (!pinEntry) { setPinError('Enter your PIN'); return }
    setPinVerifying(true); setPinError('')
    let res: Response
    let data: { error?: string }
    try {
      res = await fetch('/api/agent/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinEntry }),
      })
      data = await res.json()
    } catch {
      setPinVerifying(false); setPinError('No connection. Check your internet and try again.'); return
    }
    setPinVerifying(false)
    if (!res.ok) {
      if (res.status === 403) {
        setPinModal(false)
        setError('No transaction PIN set. Go to Settings → Transaction PIN to set one up.')
      } else {
        setPinError(data.error ?? 'Incorrect PIN')
      }
      return
    }
    setPinModal(false)
    await submit()
  }

  async function submit() {
    if (!selected) return
    setLoading(true); setError('')

    const isBulk = bulkMode && !recordDate
    const endpoint = isBulk ? '/api/transactions/saving/bulk' : '/api/transactions/saving'
    const body = isBulk
      ? { customerId: selected.id, dates: [...selectedDates].sort(), method, planId: plan?.id }
      : { customerId: selected.id, amount, method, planId: plan?.id, ...(recordDate ? { date: recordDate } : {}) }

    let res: Response
    let data: { error?: string; code?: string; total?: number; transaction?: { id?: string; ref?: string }; transactions?: { id?: string; ref?: string }[] }
    try {
      res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      data = await res.json()
    } catch {
      // The request may still have reached the server, so don't invite a blind retry.
      setError('We lost the connection. Check Today’s savings before recording again, so the customer isn’t charged twice.')
      setLoading(false); setRefreshKey(k => k + 1); return
    }
    if (res.status === 403 && data.code === 'PHOTO_REQUIRED' && selected) { const id = selected.id; setPhotoRefused(s => new Set(s).add(id)); setLoading(false); return }
    if (!res.ok) { setError(data.error ?? 'The saving could not be recorded. Please try again.'); setLoading(false); return }
    setLoading(false)
    update()

    if (recordDate) {
      router.push(`/dashboard/calendar?cid=${encodeURIComponent(selected.customerId)}&t=${Date.now()}`)
      return
    }

    const totalAmt = isBulk ? (data.total ?? 0) : parseFloat(amount)
    const activePlan = plan ?? selected.savingsPlans?.find(p => p.status === 'Active') ?? selected.savingsPlans?.[0]
    const agentUser = session?.user as { name?: string; agentId?: string } | undefined
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const inviteUrl = agentUser?.agentId ? `${origin}/customer/enroll?aid=${agentUser.agentId}` : ''
    // This object is also what the app's receipt printer receives; keep its shape.
    setLastReceipt({
      ref: isBulk ? `${data.transactions?.[0]?.ref ?? ''} +${selectedDates.length - 1} more` : (data.transaction?.ref ?? ''),
      customer: `${selected.firstName} ${selected.lastName}`,
      customerId: selected.customerId ?? '',
      phone: maskPhone(selected.phone ?? ''),
      amount: totalAmt,
      balance: (selected.savingsBalance ?? 0) + totalAmt,
      method,
      agent: agentUser?.name ?? '',
      date: new Date().toLocaleString('en-GB'),
      goal: activePlan?.goal ?? '',
      maturityDate: activePlan?.maturityDate ? new Date(activePlan.maturityDate).toLocaleDateString('en-GB') : '',
      inviteUrl,
    })
    setLastDays(isBulk ? selectedDates.length : 1)
    setLastPhone(selected.phone ?? '')
    setLastTxIds((isBulk ? data.transactions ?? [] : data.transaction ? [data.transaction] : []).flatMap(t => t.id ? [t.id] : []))
    reset()
    setRefreshKey(k => k + 1)
  }

  function recordAnother() {
    setLastReceipt(null); setLastTxIds([]); sender.reset()
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  const canPrint = typeof window !== 'undefined'
    && !!(window as unknown as { __vochusCanPrint?: boolean }).__vochusCanPrint

  function printReceipt() {
    const w = window as unknown as { VochusPrinter?: { postMessage: (s: string) => void } }
    w.VochusPrinter?.postMessage(JSON.stringify(lastReceipt))
  }

  const canSend = lastTxIds.length > 0
  const sentNoChat = send.state === 'sent' && !send.canOpenChat
  const whatsAppFirst = sentNoChat && !!lastPhone
  const whatsAppRef = useRef<HTMLAnchorElement>(null)
  // It's now the main action and can land under the bottom nav, so bring it into view.
  useEffect(() => {
    if (whatsAppFirst) whatsAppRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [whatsAppFirst])
  const whatsAppButton = lastReceipt && lastPhone && (
    <a ref={whatsAppRef} className={`ui-btn ui-btn--block ${whatsAppFirst ? 'ui-btn--primary' : 'ui-btn--secondary'}`} href={whatsAppLink(lastPhone, lastReceipt, lastDays)} target="_blank" rel="noopener noreferrer">
      <Icons.share size={18} aria-hidden="true" /> Send receipt on WhatsApp
    </a>
  )
  const redeemed = selected?.planStatus === 'Redeemed'
  const onlineSel = selected?.type === 'online'
  /** Every plan has ended (or been collected) but the customer isn't on the new-plan form: nothing to save into. */
  const nothingOpen = !!selected && !redeemed && activePlans.length === 0
  const finishedPlans = (selected?.savingsPlans ?? [])
    // Ended but not yet redeemed: these can be rolled over. A redeemed plan (or a collected Ajo pot) is closed for good.
    .filter(p => p.cadence !== 'ajo' && p.status === 'Active' && p.maturityDate !== null && new Date(p.maturityDate).getTime() <= Date.now())
    .slice(0, 3)
  const bulkTotal = (onlineCal?.perSlot ?? plan?.dailyAmount ?? 0) * selectedDates.length
  const bulkUnit = onlineCal?.weekly ? 'week' : 'day'
  const payAmount = bulkMode ? bulkTotal : parseFloat(amount || '0')
  const short = walletBalance !== null && payAmount > 0 && payAmount > walletBalance
  // Only this plan's savings count. Weekly and monthly cash plans keep the one-a-day rule until whole-period Bulk Savings
  // goes live, and online weeks and months hold one saving. Flexible plans can be paid into at any time.
  const cashPeriod = !!plan && plan.source !== 'self' && (plan.cadence === 'weekly' || plan.cadence === 'monthly')
  const paidCadence = cashPeriod ? 'daily' : plan?.cadence
  const planSaves = plan ? (paidToday ?? []).filter(p => p.planId === plan.id) : []
  const periodPaid = !!plan?.startDate && !!plan.maturityDate && periodAlreadySaved(
    buildSlots({ startDate: plan.startDate, maturityDate: plan.maturityDate, periodDays: plan.periodDays, cadence: paidCadence ?? undefined }, planSaves.map(p => p.createdAt)),
    dateKey(new Date()),
    paidCadence,
  )
  // A daily plan lists today's savings; on a longer period the latest one is the one that paid it.
  const paidList = paidCadence === 'weekly' || paidCadence === 'monthly'
    ? planSaves.slice(0, 1).map(p => `${formatNaira(p.amount, { minor: false })} on ${formatDate(p.createdAt)}`)
    : planSaves.filter(p => dateKey(new Date(p.createdAt)) === dateKey(new Date())).map(p => `${formatNaira(p.amount, { minor: false })} at ${p.time}`)
  const alreadyPaid = !flexPlan && !bulkMode && !recordDate && periodPaid ? paidList : null
  const returnHere = selected ? `/dashboard/savings?cid=${encodeURIComponent(selected.customerId)}` : '/dashboard/savings'
  const lateDateLabel = recordDate
    ? new Date(recordDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <RetakePhotoSheet
        customer={photoFor && { id: photoFor.id, name: `${photoFor.firstName} ${photoFor.lastName}`, hasPhoto: !!photoFor.photoUrl }}
        startShot={photoStart}
        onClose={() => { setPhotoFor(null); setPhotoStart(null) }}
        onSubmitted={() => { const id = photoFor?.id; setSelected(c => (c && c.id === id ? { ...c, photoStatus: 'pending' } : c)) }}
      />
      {reopenFor && selected && (
        <ReopenCodeSheet
          open
          onClose={() => setReopenFor(null)}
          who={{ kind: 'agent', customerName: selected.firstName }}
          planName={reopenFor.name}
          kind={reopenFor.kind}
          rollover={reopenFor.rollover}
          sendUrl="/api/customers/plan/reopen/code"
          confirmUrl="/api/customers/plan/reopen"
          body={{ customerId: selected.id, planId: reopenFor.id }}
          onDone={reopenDone}
        />
      )}

      <div className="ag-home-grid">
        <div className="ag-col">
          {recordDate && !lastReceipt && (
            <div className="ui-banner ui-banner--info">
              <Icons.calendar size={18} aria-hidden="true" />
              <div>Recording a late saving for <strong>{lateDateLabel}</strong></div>
            </div>
          )}

          <FormError message={error} />

          {lastReceipt ? (
            <section className="ui-card ag-done" aria-live="polite">
              <span className="ui-status ui-status--success ui-status--lg">
                <Icons.check size={16} aria-hidden="true" /> Saving recorded
              </span>
              <p className="ui-amount ui-amount--hero">{formatNaira(lastReceipt.amount)}</p>
              <p className="ui-row-sub">for <strong className="ag-done-name">{displayName(lastReceipt.customer)}</strong></p>

              <dl className="ag-done-rows">
                {lastDays > 1 && <div><dt>{onlineCal?.weekly ? 'Weeks paid' : 'Days paid'}</dt><dd>{lastDays}</dd></div>}
                <div><dt>New balance</dt><dd>{formatNaira(lastReceipt.balance)}</dd></div>
                <div><dt>Paid in</dt><dd>{lastReceipt.method}</dd></div>
                {lastReceipt.goal && <div><dt>Plan</dt><dd>{lastReceipt.goal}</dd></div>}
                <div><dt>Reference</dt><dd className="ag-mono">{lastReceipt.ref}</dd></div>
              </dl>

              <div style={{ width: '100%', textAlign: 'left', marginTop: send.error || sentNoChat ? 'var(--ui-s4)' : 0 }}>
                <SendReceiptNotices send={send} />
              </div>

              <div className="ag-done-actions">
                {canSend && <SendReceiptButton send={send} onSend={() => sender.send(lastTxIds)} block />}
                {whatsAppFirst && whatsAppButton}
                <button type="button" className={`ui-btn ui-btn--block ${canSend && (send.state !== 'sent' || whatsAppFirst) ? 'ui-btn--secondary' : 'ui-btn--primary'}`} onClick={recordAnother}>
                  <Icons.add size={18} aria-hidden="true" /> Record another
                </button>
                {!whatsAppFirst && whatsAppButton}
                {canPrint && (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={printReceipt}>
                    <Icons.print size={18} aria-hidden="true" /> Print receipt
                  </button>
                )}
              </div>
            </section>
          ) : !selected ? (
            <section className="ui-card" aria-labelledby="find-title">
              <h2 id="find-title" className="ui-card-title ag-card-title">Find the customer</h2>
              <div className="ag-search">
                <Icons.search size={20} aria-hidden="true" />
                <input
                  ref={searchRef}
                  className="ui-input"
                  type="search"
                  enterKeyHint="search"
                  placeholder="Name, phone or customer ID"
                  aria-label="Search customers"
                  autoComplete="off"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                {searching && <span className="ui-spinner ag-search-spin" aria-label="Searching" />}
              </div>

              {results.length > 0 && (
                <div className="ag-results" aria-label="Matching customers">
                  {results.map(c => (
                    <ListRow
                      key={c.id}
                      leading={<CustomerAvatar c={c} />}
                      title={displayName(`${c.firstName} ${c.lastName}`)}
                      sub={`${c.customerId} · ${c.phone}`}
                      value={<span className="ui-value-stack">{formatNaira(c.savingsBalance, { minor: false })}</span>}
                      onClick={() => choose(c)}
                    />
                  ))}
                </div>
              )}
              {!searching && searchedFor && searchedFor === query.trim() && results.length === 0 && (
                searchFailed
                  ? <p className="ui-note"><Icons.error size={16} aria-hidden="true" /> Couldn’t search. Check your connection.</p>
                  : <p className="ui-note">No customer matches “{searchedFor}”.</p>
              )}
              {!query.trim() && (recent.length > 0 ? (
                <>
                  <p className="ag-recent-label">Recent</p>
                  <div className="ag-recent">
                    {recent.map(r => {
                      const [f = '', l = ''] = r.name.split(' ')
                      return (
                        <button key={r.code} type="button" className="ag-recent-item" onClick={() => chooseRecent(r.code)}>
                          {r.photoUrl
                            ? <img src={r.photoUrl} className="ui-avatar" alt="" />
                            : <span className={`ui-avatar ag-av ag-av--${avatarTint(r.code)}`} aria-hidden="true">{f[0]}{l[0]}</span>}
                          <span className="ag-recent-name">{displayName(f)}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : <p className="ui-note">Search, then tap the customer who paid you.</p>)}
            </section>
          ) : (
            <>
              <section className="ui-card ag-customer" aria-label="Customer">
                <CustomerAvatar c={selected} />
                <div className="ag-customer-main">
                  <p className="ui-row-title">{displayName(`${selected.firstName} ${selected.lastName}`)}</p>
                  <p className="ui-row-sub">{selected.customerId} · {selected.phone}</p>
                  <p className="ui-row-sub">Balance <strong className="ag-customer-bal">{formatNaira(selected.savingsBalance)}</strong></p>
                </div>
                <button type="button" className="ui-link" onClick={changeCustomer}>Change</button>
              </section>

              {finishedPlans.length > 0 && (
                <section className="ui-card ui-card--list" aria-label="Finished plans">
                  {finishedPlans.map(p => (
                    <div key={p.id} className="ui-row">
                      <span className="ui-row-main">
                        <span className="ui-row-title ui-block">{p.goal}</span>
                        <span className="ui-row-sub ui-block">{isFlexible(p.cadence) ? 'Flexible' : `${formatNaira(perPayment(p), { minor: false })} a ${planUnit(p)}`} · {p.maturityDate ? `ended ${formatDate(p.maturityDate)}` : 'ended'}</span>
                      </span>
                      <button type="button" className="ui-btn ui-btn--secondary" disabled={loading}
                        onClick={() => setReopenFor({ id: p.id, name: p.goal, kind: 'rollover', rollover: { balance: p.balance, periodDays: p.periodDays } })}>
                        Roll over
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {redeemed && onlineSel ? (
                <section className="ui-card">
                  <EmptyState icon="plan" title="No plan open for saving" text="This customer saves on the app. They open their own plans." />
                </section>
              ) : redeemed ? (
                <NewPlanForm plan={newPlan} setPlan={setNewPlan} />
              ) : nothingOpen ? (
                <section className="ui-card">
                  <EmptyState icon="plan" title="No plan open for saving"
                    text={onlineSel
                      ? (finishedPlans.length > 0 ? 'Their plan has ended. Tap Roll over above to keep saving into it. They open new plans in the app.' : 'This customer saves on the app. They open their own plans.')
                      : finishedPlans.length > 0 ? 'Their plan has ended. Tap Roll over above to keep saving into it, or start a new plan.' : 'Start a new plan for them to keep saving.'}
                    action={onlineSel ? undefined : <Link href={`/dashboard/add-plan?cid=${encodeURIComponent(selected.customerId)}`} className="ui-btn ui-btn--secondary">Start a new plan</Link>} />
                </section>
              ) : (
                <section className="ui-card" aria-labelledby="saving-title">
                  <h2 id="saving-title" className="ui-card-title ag-card-title">What are they paying for?</h2>
                  {choosePlan && (
                    <div className="ag-radio-group ag-plan-pick" role="radiogroup" aria-label="Which plan">
                      <p className="ag-label">They have {activePlans.length} plans. Which one is this for?</p>
                      {activePlans.map(p => (
                        <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className="ag-radio"
                          onClick={() => { setPlanId(p.id); setError(''); setSelectedDates([]) }}>
                          <span className="ag-payee-main">
                            <span className="ui-row-title ui-block">{p.goal}</span>
                            <span className="ui-row-sub ui-block">{isFlexible(p.cadence) ? 'Flexible, any amount' : `${formatNaira(perPayment(p), { minor: false })} a ${planUnit(p)}`}{p.startDate ? ` · ${formatDate(p.startDate)}${p.maturityDate ? ` to ${formatDate(p.maturityDate)}` : ''}` : ''} · {formatNaira(p.balance, { minor: false })} saved</span>
                          </span>
                          <span className="ui-radio" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                  {!recordDate && !flexPlan && (
                    <div className="ui-segment ag-segment" role="group" aria-label="Days to record">
                      <button type="button" aria-pressed={!bulkMode} onClick={() => setBulkMode(false)}>Today</button>
                      <button type="button" aria-pressed={bulkMode} onClick={() => setBulkMode(true)}>Bulk Savings</button>
                    </div>
                  )}

                  {bulkMode && !recordDate ? (
                    !plan ? (
                      <p className="ui-note ui-note--center">{choosePlan ? 'Choose a plan above, then tap the days they’re paying for.' : 'This customer has no active plan.'}</p>
                    ) : <DayPicker
                      loading={paidDatesLoading}
                      planStartDate={planStartDate}
                      planLastDate={planLastDate}
                      paidDates={paidDates}
                      selectedDates={selectedDates}
                      setSelectedDates={setSelectedDates}
                      view={calendarView}
                      setView={setCalendarView}
                      dailyAmount={plan?.dailyAmount ?? null}
                      online={onlineCal}
                    />
                  ) : (
                    plan && flexPlan ? (
                          <div className="ag-tf-wrap ui-block">
                            <div className="ag-tf">
                              <label className="ag-tf-label" htmlFor="flex-amt">Amount they’re paying</label>
                              <span className="ag-tf-money">
                                <span aria-hidden="true">₦</span>
                                <input id="flex-amt" className="ag-tf-input ag-tf-num" type="tel" inputMode="decimal" autoComplete="off" onKeyDown={blockMinus}
                                  placeholder="Any amount" value={amount} onChange={e => { setAmount(nonNegativeString(e.target.value)); setError('') }} />
                              </span>
                            </div>
                            <p className="ag-fineprint">Flexible plan{choosePlan ? ` · ${plan.goal}` : ''}: any amount from {formatNaira(flexTerms.minDeposit, { minor: false })}, as often as they like.</p>
                          </div>
                    ) : (
                    <div className="ag-pay-amount">
                      {plan
                        ? <>
                            <span className="ui-amount ui-amount--hero">{formatNaira(parseFloat(amount || '0'), { minor: false })}</span>
                            <span className="ui-row-sub">Their agreed amount for {recordDate ? 'that day' : `one ${planUnit(plan)}`}{choosePlan ? ` · ${plan.goal}` : ''}</span>
                          </>
                        : <span className="ui-row-sub">{choosePlan ? 'Choose a plan above to see the amount.' : 'This customer has no active plan.'}</span>}
                    </div>
                    )
                  )}

                  {alreadyPaid && (
                    <div className="ui-banner ui-banner--warn ag-card-banner" role="status">
                      <Icons.error size={18} aria-hidden="true" />
                      <div>
                        <strong>Already paid {periodWord(paidCadence)}:</strong>{' '}
                        {alreadyPaid.join(', ')}.
                      </div>
                    </div>
                  )}
                  {short && (
                    <div className="ui-banner ui-banner--danger ag-card-banner" role="alert">
                      <Icons.wallet size={18} aria-hidden="true" />
                      <div>
                        Your wallet has <strong>{formatNaira(walletBalance ?? 0)}</strong>, not enough for {formatNaira(payAmount, { minor: false })}.{' '}
                        <Link href={`/dashboard/wallet?return=${encodeURIComponent(returnHere)}`} className="ag-banner-link">Top up wallet</Link>
                      </div>
                    </div>
                  )}
                  <div className="ag-paid-in">
                    <Icons.cash size={20} aria-hidden="true" />
                    <span>Paid in</span>
                    <strong>{method}</strong>
                  </div>
                  {walletBalance !== null && !short && payAmount > 0 && (
                    <p className="ag-wallet-after">Wallet after: <strong>{formatNaira(walletBalance - payAmount)}</strong></p>
                  )}
                </section>
              )}

              <div className="ag-submit">
                {redeemed && onlineSel ? null : redeemed ? (
                  <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={loading} onClick={createPlan}>
                    {loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Creating plan…</> : 'Create savings plan'}
                  </button>
                ) : nothingOpen ? null : selPaused && selected ? (
                  <div className="photo-remind photo-remind--red" role="alert">
                    <Icons.camera size={20} aria-hidden="true" />
                    <div className="photo-remind-body">
                      <p className="photo-remind-title">Saving is paused until {selected.firstName}’s photo is added.</p>
                      <p className="photo-remind-text">{selected.photoStatus === 'pending' ? 'Their photo is being checked. Saving starts again once it’s approved.' : 'Take their photo. Saving starts again once the office approves it.'}</p>
                      {selected.photoStatus !== 'pending' && <PhotoButtons onTake={() => { setPhotoStart(null); setPhotoFor(selected) }} onUpload={data => { setPhotoStart(data); setPhotoFor(selected) }} />}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary ui-btn--block"
                    disabled={loading || short || !!alreadyPaid || (bulkMode && selectedDates.length === 0)}
                    onClick={requestPin}
                  >
                    {loading
                      ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Recording…</>
                      : payAmount > 0 ? `${alreadyPaid ? 'Already recorded' : 'Record'} ${formatNaira(payAmount, { minor: false })}` : 'Record saving'}
                  </button>
                )}
                <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={reset} disabled={loading}>Cancel</button>
              </div>
            </>
          )}
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Today’s savings</h2></div>
          <section className="ui-card ag-today" aria-label="Today’s savings">
            <span className="ui-row-sub">Collected today</span>
            <p className="ui-amount ag-today-total">{formatNaira(todayTotal)}</p>
            <p className="ui-row-sub">
              {todaySavings === null ? 'Loading…' : todaySavings.length > 0 ? `Latest ${todaySavings.length} below` : todayTotal > 0 ? 'Recorded today' : 'Nothing recorded yet'}
            </p>
          </section>
          {todaySavings && todaySavings.length > 0 && (
            <section className="ui-card ui-card--list">
              {todaySavings.map((s, i) => (
                <ListRow
                  key={i}
                  leading={<span className="ui-avatar" aria-hidden="true">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>}
                  title={displayName(s.name)}
                  sub={`${s.time} · ${s.method}`}
                  value={<span className="ui-value-stack ui-amount--positive">+{formatNaira(s.amount, { minor: false })}</span>}
                />
              ))}
            </section>
          )}
          {todaySavings && todaySavings.length === 0 && todayTotal === 0 && (
            <section className="ui-card">
              <EmptyState icon="plan" title="Nothing recorded yet today" text="Savings you record will show here." />
            </section>
          )}
        </div>
      </div>

      <BottomSheet open={noPinModal} onClose={() => setNoPinModal(false)} title="Set a transaction PIN">
        <p className="ag-sheet-text">You need a transaction PIN before you can record savings. It keeps customers’ money safe if your phone is lost.</p>
        <div className="ui-stack">
          <Link href="/dashboard/settings" className="ui-btn ui-btn--primary ui-btn--block">Set PIN in Settings</Link>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => setNoPinModal(false)}>Not now</button>
        </div>
      </BottomSheet>

      <BottomSheet open={pinModal} onClose={() => setPinModal(false)} title="Confirm with your PIN">
        <p className="ag-sheet-text">
          Record <strong>{formatNaira(payAmount, { minor: false })}</strong>
          {bulkMode ? ` (${selectedDates.length} ${bulkUnit}${selectedDates.length === 1 ? '' : 's'})` : ''} for{' '}
          <strong>{displayName(`${selected?.firstName ?? ''} ${selected?.lastName ?? ''}`)}</strong>
        </p>
                {pinModal && (
          <PinPad
            value={pinEntry}
            onChange={v => { setPinEntry(v); setPinError('') }}
            onSubmit={confirmPin}
            busy={pinVerifying}
            error={pinError}
          />
        )}
      </BottomSheet>
    </div>
  )
}

/* ── Bulk Savings: month calendar of the plan ── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function toDS(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

type OnlineCalendar = { eligible: boolean; weekly: boolean; perSlot: number; slots: { key: string; state: string }[] }

function DayPicker({ loading, planStartDate, planLastDate, paidDates, selectedDates, setSelectedDates, view, setView, dailyAmount, online }: {
  loading: boolean
  planStartDate: string | null
  planLastDate: string | null
  paidDates: string[]
  selectedDates: string[]
  setSelectedDates: (fn: (prev: string[]) => string[]) => void
  view: { year: number; month: number }
  setView: (fn: (v: { year: number; month: number }) => { year: number; month: number }) => void
  dailyAmount: number | null
  online: OnlineCalendar | null
}) {
  if (loading) return <div className="ag-cal-state"><span className="ui-spinner" aria-label="Loading the plan’s days" /></div>
  if (!planStartDate) return <p className="ui-note ui-note--center">This customer has no active plan.</p>
  if (online && !online.eligible) return <p className="ui-note ui-note--center">Bulk Savings isn’t available on this online plan. Record a single saving instead.</p>

  // On an online plan a date stands for its slot: a tap on any day of a week picks that whole week.
  const unit = online?.weekly ? 'week' : 'day'
  const slotOf = (ds: string) => (online ? slotKeyForDate(online.slots, ds, online.weekly) : ds)
  const slotPrice = online?.perSlot ?? dailyAmount

  const { year, month } = view
  const today = new Date()
  const todayStr = toDS(today.getFullYear(), today.getMonth(), today.getDate())
  const paidSet = new Set(paidDates)
  const selectedSet = new Set(selectedDates)
  const planStart = new Date(planStartDate + 'T00:00:00')
  const canGoPrev = new Date(year, month, 1) > new Date(planStart.getFullYear(), planStart.getMonth(), 1)
  const planLast = planLastDate ? new Date(planLastDate + 'T00:00:00') : null
  const canGoNext = !planLast || new Date(year, month + 1, 1) <= planLast
  const numDays = new Date(year, month + 1, 0).getDate()
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function nav(delta: number) {
    setView(v => {
      let m = v.month + delta, y = v.year
      if (m < 0) { m = 11; y-- }
      if (m > 11) { m = 0; y++ }
      return { year: y, month: m }
    })
  }

  const sorted = [...selectedDates].sort()
  return (
    <div className="ag-cal">
      <p className="ui-row-sub ag-cal-hint">
        {online?.weekly ? 'Tap any day in each week they are paying for' : 'Tap each day they are paying for'}{slotPrice ? ` (${formatNaira(slotPrice, { minor: false })} a ${unit})` : ''}.
      </p>
      <div className="ui-cal-head">
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => nav(-1)} disabled={!canGoPrev} aria-label="Previous month">
          <Icons.back size={20} aria-hidden="true" />
        </button>
        <span className="ui-cal-title" aria-live="polite">{MONTHS[month]} {year}</span>
        <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={() => nav(1)} disabled={!canGoNext} aria-label="Next month">
          <Icons.next size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="ui-cal-grid" aria-hidden="true">
        {DOW.map((l, i) => <span key={i} className="ui-cal-dow">{l}</span>)}
      </div>
      <ul className="ui-cal-grid">
        {cells.map((day, idx) => {
          if (!day) return <li key={idx} aria-hidden="true" />
          const ds = toDS(year, month, day)
          const slot = slotOf(ds)
          const afterEnd = !!planLast && new Date(year, month, day) > planLast
          const beforeStart = new Date(year, month, day) < planStart || slot === null || afterEnd
          const isPaid = slot !== null && paidSet.has(slot)
          const isSel = slot !== null && selectedSet.has(slot)
          const isToday = ds === todayStr
          const label = new Date(year, month, day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
          const cls = ['ui-cal-day', 'ag-cal-day',
            beforeStart ? 'ui-cal-day--off' : isPaid ? 'ui-cal-day--saved' : isSel ? 'ag-cal-day--picked' : '',
            isToday ? 'ag-cal-day--today' : '',
          ].filter(Boolean).join(' ')
          return (
            <li key={idx}>
              <button
                type="button"
                className={cls}
                disabled={beforeStart || isPaid}
                aria-pressed={isPaid ? undefined : isSel}
                aria-label={`${label}${isPaid ? ', already paid' : afterEnd ? ', after the plan ends' : beforeStart ? ', before the plan started' : ''}${isToday ? ', today' : ''}`}
                onClick={() => { if (slot) setSelectedDates(prev => prev.includes(slot) ? prev.filter(x => x !== slot) : [...prev, slot]) }}
              >
                {day}
              </button>
            </li>
          )
        })}
      </ul>
      <ul className="ui-key ag-cal-key">
        <li><span className="ui-cal-day ui-cal-day--saved" aria-hidden="true" /> Already paid</li>
        <li><span className="ui-cal-day ag-cal-day--picked" aria-hidden="true" /> Paying now</li>
      </ul>
      <div className="ag-cal-total">
        <div>
          <span className="ui-row-sub ui-block">
            {sorted.length === 0 ? `No ${unit}s chosen yet` : `${sorted.length} ${unit}${sorted.length === 1 ? '' : 's'}`}
          </span>
          {sorted.length > 0 && (
            <span className="ag-cal-dates">
              {sorted.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(', ')}
            </span>
          )}
        </div>
        {slotPrice && sorted.length > 0 && (
          <span className="ui-amount ag-cal-sum">{formatNaira(slotPrice * sorted.length, { minor: false })}</span>
        )}
      </div>
    </div>
  )
}

/* ── Previous plan collected: start a new one ── */

function NewPlanForm({ plan, setPlan }: { plan: typeof EMPTY_PLAN; setPlan: (fn: (p: typeof EMPTY_PLAN) => typeof EMPTY_PLAN) => void }) {
  const isW = plan.cadence === 'weekly'
  const isM = plan.cadence === 'monthly'
  const rawAmt = parseFloat(plan.dailyAmount) || 0
  const dailyEquiv = isW ? rawAmt / 7 : isM ? rawAmt / 30 : rawAmt
  const previewTotal = rawAmt && plan.periodDays ? Math.round(dailyEquiv * parseInt(plan.periodDays)) : 0
  const fees = usePlanFees()
  // Once the new fee model is on, show what it will really take; until then the old estimate.
  const feePreview = fees.live && previewTotal > 0 ? planFeePreview({ cadence: plan.cadence, amountPerPayment: rawAmt, totalSaved: previewTotal, periodicFeePct: fees.periodicFeePct }) : null
  const deductionPreview = feePreview
    ? feePreview.total
    : previewTotal > 0
      ? (isW || isM
        ? Math.round(previewTotal * 0.20 * 100) / 100
        : Math.round(dailyEquiv * (parseInt(plan.periodDays) / 31) * 100) / 100)
      : 0
  const unit = isW ? 'Weekly' : isM ? 'Monthly' : 'Daily'
  const start = parseDateInput(plan.startDate) ?? today()

  return (
    <section className="ui-card" aria-labelledby="plan-title">
      <h2 id="plan-title" className="ui-card-title ag-card-title">Start a new plan</h2>
      <div className="ui-banner ui-banner--info">
        <Icons.locked size={18} aria-hidden="true" />
        <div>Their last plan has been redeemed. Start a new plan to keep saving.</div>
      </div>

      <div className="ui-field">
        <span className="ui-label" id="cadence-label">How often they save</span>
        <div className="ui-segment" role="group" aria-labelledby="cadence-label">
          {(['daily', 'weekly', 'monthly'] as const).map(c => (
            <button key={c} type="button" aria-pressed={plan.cadence === c}
              onClick={() => setPlan(p => ({ ...p, cadence: c, endDate: '', periodDays: c === 'daily' ? '90' : c === 'weekly' ? '56' : '60' }))}>
              {c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-field">
        <label className="ui-label" htmlFor="plan-amount">{unit} amount</label>
        <div className="ui-input-wrap">
          <span className="ui-input-prefix" aria-hidden="true">₦</span>
          <input id="plan-amount" className="ui-input ui-input--number ui-input--prefixed" type="tel" inputMode="decimal" onKeyDown={blockMinus}
            placeholder={isW ? '3,500' : isM ? '15,000' : '500'}
            value={plan.dailyAmount} onChange={e => setPlan(p => ({ ...p, dailyAmount: nonNegativeString(e.target.value) }))} />
        </div>
      </div>

      <div className="ui-field">
        <label className="ui-label" htmlFor="plan-period">How long</label>
        <select id="plan-period" className="ui-input ui-select" value={plan.endDate ? 'custom' : plan.periodDays} onChange={e => {
          const v = e.target.value
          if (v === 'custom') {
            const end = isoDate(addDays(start, parseInt(plan.periodDays || '0') || 30))
            setPlan(p => ({ ...p, endDate: end, periodDays: String(endDateDays(end, start, p.cadence) ?? '') }))
          } else setPlan(p => ({ ...p, endDate: '', periodDays: v }))
        }}>
          {PERIODS[plan.cadence].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="custom">Choose an end date…</option>
        </select>
      </div>
      {plan.endDate && (
        <EndDateField picker start={start} cadence={plan.cadence} value={plan.endDate}
          onChange={(v, days) => setPlan(p => ({ ...p, endDate: v, periodDays: days ? String(days) : '' }))} />
      )}

      <div className="ui-field">
        <label className="ui-label" htmlFor="plan-goal">What are they saving for?</label>
        <input id="plan-goal" className="ui-input" type="text" placeholder="e.g. School fees, business stock"
          value={plan.goal} onChange={e => setPlan(p => ({ ...p, goal: e.target.value }))} />
      </div>

      <div className="ui-field">
        <label className="ui-label" htmlFor="plan-start">Start date <span className="ui-link--muted">(optional)</span></label>
        <DatePicker id="plan-start" ariaLabel="Plan start date" sheetTitle="Pick a start date" todayPrefix
          value={plan.startDate || isoDate(today())} onChange={iso => {
            const v = iso === isoDate(today()) ? '' : iso
            // Keep a chosen end date where it is; the length changes instead.
            setPlan(p => ({ ...p, startDate: v, periodDays: p.endDate ? String(endDateDays(p.endDate, parseDateInput(v) ?? today(), p.cadence) ?? '') : p.periodDays }))
          }} />
      </div>

      {previewTotal > 0 && (
        <dl className="ag-done-rows ag-plan-preview">
          <div><dt>Total at the end</dt><dd>{formatNaira(previewTotal, { minor: false })}</dd></div>
          {deductionPreview > 0 && <div><dt>{feePreview ? (feePreview.kind === 'first-day' ? 'Platform fee (first day’s savings)' : 'Platform fee (from each deposit)') : 'Platform fee at the end'}</dt><dd>−{formatNaira(deductionPreview)}</dd></div>}
        </dl>
      )}
    </section>
  )
}
