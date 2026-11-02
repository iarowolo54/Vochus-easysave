import Link from 'next/link'
import Amount from '@/components/ui/Amount'
import EmptyState from '@/components/ui/EmptyState'
import TodayRound from '@/components/agent/TodayRound'
import { Icons, type IconName } from '@/components/ui/icons'
import { displayName, formatDate, formatNaira, formatTime } from '@/lib/format'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

const PAGE_SIZE = 5

function fmtAmt(n: number) {
  if (n >= 1000) return `₦${(n / 1000).toFixed(0)}K`
  return `₦${n.toLocaleString()}`
}

function daysDiff(date: Date): number {
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const TXN: Record<string, { label: string; icon: IconName; sign: '+' | '−' | '' }> = {
  saving:         { label: 'Saving',          icon: 'deposit',  sign: '+' },
  redemption:     { label: 'Collection paid', icon: 'collect',  sign: '−' },
  repayment:      { label: 'Loan repayment',  icon: 'repay',    sign: '' },
  disbursement:   { label: 'Loan disbursed',  icon: 'loan',     sign: '' },
  enrolment:      { label: 'New customer',    icon: 'enrol',    sign: '' },
  registration:   { label: 'Registration fee', icon: 'enrol',   sign: '' },
  wallet_funding: { label: 'Wallet top-up',   icon: 'wallet',   sign: '+' },
}

function txn(type: string) {
  return TXN[type] ?? { label: type.replace(/_/g, ' '), icon: 'history' as IconName, sign: '' as const }
}

function txnIcon(type: string, method: string | null): IconName {
  if (type === 'saving') return (method ?? '').toLowerCase() === 'paystack' ? 'card' : 'cash'
  return txn(type).icon
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) redirect('/login')

  const sp = await searchParams
  const page = Math.max(1, parseInt(String(sp.mpage ?? '1'), 10))

  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0)
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0)
  const in7Days = new Date(now)
  in7Days.setDate(in7Days.getDate() + 7)
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const firstName = agent.name.split(' ')[0]
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const maturingWhere = {
    customer: { agentId: agent.id },
    status: 'Active',
    maturityDate: { gte: now, lte: in7Days },
  }

  const startOfMonth = new Date(currentYear, currentMonth - 1, 1)
  const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59)

  const [customerCount, activeLoansCount, commissionRecord, monthSavingAgg, monthRegistrationCount, recentTxns, maturingSoon, maturingTotal, loanPortfolio, weeklyTxns,
    onlineSavingDay, onlineSavingWeek, cashSavingDay, cashSavingWeek] = await Promise.all([
    prisma.customer.count({ where: { agentId: agent.id } }),
    prisma.loan.count({ where: { agentId: agent.id, status: 'Disbursed' } }),
    prisma.commission.findFirst({ where: { agentId: agent.id, month: currentMonth, year: currentYear } }),
    prisma.transaction.aggregate({
      where: { agentId: agent.id, type: 'saving', createdAt: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    prisma.transaction.count({
      where: { agentId: agent.id, type: 'registration', createdAt: { gte: startOfMonth, lte: endOfMonth } },
    }),
    prisma.transaction.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { customer: true },
    }),
    prisma.savingsPlan.findMany({
      where: maturingWhere,
      include: { customer: true },
      orderBy: { maturityDate: 'asc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.savingsPlan.count({ where: maturingWhere }),
    prisma.loan.aggregate({ where: { agentId: agent.id, status: 'Disbursed' }, _sum: { principal: true } }),
    prisma.transaction.findMany({
      where: {
        agentId: agent.id,
        type: 'saving',
        createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 1, 1) },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.transaction.aggregate({ where: { agentId: agent.id, type: 'saving', status: 'Done', method: 'Paystack', createdAt: { gte: startOfDay } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { agentId: agent.id, type: 'saving', status: 'Done', method: 'Paystack', createdAt: { gte: startOfWeek } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { agentId: agent.id, type: 'saving', status: 'Done', method: 'Cash', createdAt: { gte: startOfDay } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { agentId: agent.id, type: 'saving', status: 'Done', method: 'Cash', createdAt: { gte: startOfWeek } }, _sum: { amount: true } }),
  ])

  const totalPages = Math.ceil(maturingTotal / PAGE_SIZE)

  // Show actual credited commission balance (matches Withdraw page)
  const commissionAmount = commissionRecord?.amount ?? Math.round(agent.commissionBalance * 100) / 100

  const weeklyCollections: { label: string; total: number }[] = []
  for (let w = 3; w >= 0; w--) {
    const end = new Date(now)
    end.setDate(end.getDate() - w * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 7)
    const total = weeklyTxns.filter(t => t.createdAt >= start && t.createdAt < end).reduce((s, t) => s + t.amount, 0)
    weeklyCollections.push({ label: `W${4 - w}`, total })
  }

  const maxWeekly = Math.max(...weeklyCollections.map(w => w.total), 1)

  const cashToday = cashSavingDay._sum.amount ?? 0
  const onlineToday = onlineSavingDay._sum.amount ?? 0
  const cashWeek = cashSavingWeek._sum.amount ?? 0
  const onlineWeek = onlineSavingWeek._sum.amount ?? 0
  const monthLabel = now.toLocaleString('en-GB', { month: 'long' })

  return (
    <div className="ag-home">
      <section className="ag-hello">
        <div>
          <h2 className="ui-page-title">{greeting}, {displayName(firstName)}</h2>
          <p className="ui-row-sub">{dateStr}</p>
        </div>
        <nav className="ag-hello-actions" aria-label="Main actions">
          <Link href="/dashboard/savings" className="ui-btn ui-btn--primary"><Icons.plan size={18} aria-hidden="true" /> Record saving</Link>
          <Link href="/dashboard/enrol" className="ui-btn ui-btn--secondary"><Icons.enrol size={18} aria-hidden="true" /> Enrol customer</Link>
          <Link href="/dashboard/redeem" className="ui-btn ui-btn--secondary"><Icons.collect size={18} aria-hidden="true" /> Collections</Link>
        </nav>
      </section>

      <div className="ag-kpis">
        <section className="ui-card ag-wallet-card" aria-label="Wallet">
          <Amount value={agent.walletBalance} size="hero" animate />
          <Link href="/dashboard/wallet" className="ui-btn ui-btn--secondary ag-wallet-btn">
            <Icons.add size={18} aria-hidden="true" /> Fund wallet
          </Link>
        </section>
        <nav className="ui-actions ag-actions" aria-label="Main actions">
          <Link href="/dashboard/savings" className="ui-action">
            <span className="ui-action-circle" aria-hidden="true"><Icons.plan size={24} /></span>Record saving
          </Link>
          <Link href="/dashboard/enrol" className="ui-action">
            <span className="ui-action-circle" aria-hidden="true"><Icons.enrol size={24} /></span>Enrol
          </Link>
          <Link href="/dashboard/redeem" className="ui-action">
            <span className="ui-action-circle" aria-hidden="true"><Icons.collect size={24} /></span>Collections
          </Link>
        </nav>
        <Collected label="Collected today" cash={cashToday} online={onlineToday} />
        <Collected label="Collected this week" cash={cashWeek} online={onlineWeek} />
      </div>

      <TodayRound />

      <div className="ag-home-grid">
        <div className="ag-block ag-block--recent">
          <div className="ui-section-head">
            <h2>Recent transactions</h2>
            <Link href="/dashboard/transactions" className="ui-link">See all <Icons.next size={16} aria-hidden="true" /></Link>
          </div>
          <section className="ui-card ui-card--list">
            {recentTxns.length === 0 ? (
              <EmptyState icon="history" title="No transactions yet" text="Savings you record will show up here." />
            ) : recentTxns.map(t => {
              const m = txn(t.type)
              const Icon = Icons[txnIcon(t.type, t.method)]
              const who = t.customer ? displayName(`${t.customer.firstName} ${t.customer.lastName}`) : '—'
              const done = t.status === 'Done'
              return (
                <Link key={t.id} href={`/dashboard/transactions/${t.id}`} className="ui-row ui-row--button">
                  <span className="ui-row-icon" aria-hidden="true"><Icon size={20} /></span>
                  <span className="ui-row-main">
                    <span className="ui-row-title ui-block">{who}</span>
                    <span className="ui-row-sub ui-block">{m.label} · {formatTime(t.createdAt)}</span>
                  </span>
                  <span className="ui-value-stack">
                    <span className={`ui-row-value${m.sign === '+' ? ' ui-amount--positive' : ''}`}>
                      {t.type === 'enrolment' ? 'New' : `${m.sign}${formatNaira(t.amount)}`}
                    </span>
                    {!done && <span className="ui-status ui-status--warn ui-status--sm">{t.status}</span>}
                  </span>
                  <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
                </Link>
              )
            })}
          </section>
        </div>
        <div className="ag-block ag-block--overview">
          <div className="ui-section-head"><h2>Overview</h2></div>
          <section className="ui-card ui-card--list" aria-label="Overview">
            <Link href="/dashboard/customers" className="ui-row ui-row--button ag-overview-row">
              <span className="ui-row-icon" aria-hidden="true"><Icons.customers size={20} /></span>
              <span className="ui-row-main"><span className="ui-row-sub ui-block">Customers</span><span className="ui-row-title ui-block">{customerCount}</span></span>
              <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
            </Link>
            <Link href="/dashboard/commission" className="ui-row ui-row--button ag-overview-row">
              <span className="ui-row-icon" aria-hidden="true"><Icons.commission size={20} /></span>
              <span className="ui-row-main"><span className="ui-row-sub ui-block">Commission · {monthLabel}</span><span className="ui-row-title ui-block">{formatNaira(commissionAmount)}</span></span>
              <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
            </Link>
            <Link href="/dashboard/loan-repay" className="ui-row ui-row--button ag-overview-row">
              <span className="ui-row-icon" aria-hidden="true"><Icons.loan size={20} /></span>
              <span className="ui-row-main">
                <span className="ui-row-sub ui-block">Active loans</span>
                <span className="ui-row-title ui-block">{activeLoansCount} · {formatNaira(loanPortfolio._sum.principal ?? 0, { minor: false })} lent</span>
              </span>
              <Icons.next size={18} className="ui-row-chevron" aria-hidden="true" />
            </Link>
          </section>
        </div>
        <div className="ag-block ag-block--maturing">
          <div className="ui-section-head">
            <h2>Maturing this week</h2>
            {maturingTotal > 0 && <span className="ui-card-meta">{maturingTotal} plan{maturingTotal > 1 ? 's' : ''}</span>}
          </div>
          <section className="ui-card ui-card--list">
            {maturingSoon.length === 0 ? (
              <EmptyState icon="calendar" title="Nothing maturing this week" text="Plans ending in the next 7 days will show here." />
            ) : maturingSoon.map(p => {
              const days = daysDiff(new Date(p.maturityDate))
              const name = displayName(`${p.customer.firstName} ${p.customer.lastName}`)
              return (
                <div key={p.id} className="ui-row">
                  <span className="ui-avatar" aria-hidden="true">{name[0]}</span>
                  <span className="ui-row-main">
                    <span className="ui-row-title ui-block">{name}</span>
                    <span className="ui-row-sub ui-block">{formatNaira(p.balance)} · ends {formatDate(p.maturityDate)}</span>
                  </span>
                  <span className={`ui-status ui-status--sm ${days <= 1 ? 'ui-status--danger' : 'ui-status--warn'}`}>
                    {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
                  </span>
                </div>
              )
            })}
            {totalPages > 1 && (
              <div className="ag-pager">
                {page > 1 ? <Link href={`/dashboard?mpage=${page - 1}`} className="ui-link"><Icons.back size={16} aria-hidden="true" /> Previous</Link> : <span />}
                <span className="ui-row-sub">Page {page} of {totalPages}</span>
                {page < totalPages ? <Link href={`/dashboard?mpage=${page + 1}`} className="ui-link">Next <Icons.next size={16} aria-hidden="true" /></Link> : <span />}
              </div>
            )}
          </section>
        </div>
        <div className="ag-block ag-block--chart">
          <div className="ui-section-head"><h2>Last 4 weeks</h2><span className="ui-card-meta">Savings collected</span></div>
          <section className="ui-card ag-chart-card" aria-label="Savings collected per week, last four weeks">
            <ol className="ag-bars">
              {weeklyCollections.map((w, i) => {
                const current = i === weeklyCollections.length - 1
                return (
                  <li key={w.label} className={current ? 'is-current' : undefined}>
                    <span className="ag-bar-value">{fmtAmt(w.total)}</span>
                    <span className="ag-bar-track"><span className="ag-bar" style={{ height: `${Math.max(4, Math.round((w.total / maxWeekly) * 100))}%` }} /></span>
                    <span className="ag-bar-label">{current ? 'This week' : `${weeklyCollections.length - 1 - i} wk ago`}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Today / this week: the total, then how it splits between cash and online. */
function Collected({ label, cash, online }: { label: string; cash: number; online: number }) {
  const total = cash + online
  const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0
  return (
    <section className="ui-card ag-kpi" aria-label={label}>
      <span className="ui-row-sub">{label}</span>
      <p className="ui-amount ag-kpi-value">{formatNaira(total, { minor: false })}</p>
      <span className="ag-split-bar" aria-hidden="true">
        {total > 0 && <span style={{ width: `${cashPct}%` }} />}
      </span>
      <dl className="ag-split">
        <div><dt><span className="ag-dot ag-dot--cash" aria-hidden="true" />Cash</dt><dd>{formatNaira(cash, { minor: false })}</dd></div>
        <div><dt><span className="ag-dot ag-dot--online" aria-hidden="true" />Online</dt><dd>{formatNaira(online, { minor: false })}</dd></div>
      </dl>
    </section>
  )
}
