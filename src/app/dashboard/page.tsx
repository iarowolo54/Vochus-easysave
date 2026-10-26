import Link from 'next/link'
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

function txnIcon(type: string) {
  switch (type) {
    case 'saving': return '💰'
    case 'redemption': return '🎯'
    case 'repayment': return '🔄'
    case 'disbursement': return '💸'
    case 'enrolment': return '📋'
    case 'loan': return '🏦'
    case 'wallet_funding': return '💼'
    default: return '📊'
  }
}

function txnLabel(type: string) {
  const map: Record<string, string> = {
    saving: 'Saving', redemption: 'Redemption', repayment: 'Repayment',
    disbursement: 'Disburse', enrolment: 'Enrolled', loan: 'Loan App', wallet_funding: 'Wallet Top-up',
  }
  return map[type] ?? type
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/')

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) redirect('/')

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

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2)
  const avColors = ['av-g', 'av-b', 'av-gd', 'av-rd', 'av-pu']

  return (
    <>
      <div className="page-header">
        <h2>{greeting}, {firstName} 👋</h2>
        <p>Here&apos;s your activity summary for today — {dateStr}</p>
      </div>

      <div className="grid g4 stats-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card green">
          <div className="stat-icon" style={{ background: 'var(--gl)' }}>💰</div>
          <div className="stat-lbl">Agent Wallet</div>
          <div className="stat-val">₦{agent.walletBalance.toLocaleString()}</div>
          <div className="stat-trend trend-up">Live balance</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon" style={{ background: 'var(--bl)' }}>👥</div>
          <div className="stat-lbl">Active Customers</div>
          <div className="stat-val">{customerCount}</div>
          <div className="stat-trend trend-up">Enrolled</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon" style={{ background: 'var(--gdl)' }}>🏅</div>
          <div className="stat-lbl">Commission ({now.toLocaleString('default', { month: 'short' })})</div>
          <div className="stat-val">₦{commissionAmount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
          <div className="stat-trend trend-up">This month</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-icon" style={{ background: 'var(--pul)' }}>🏦</div>
          <div className="stat-lbl">Active Loans</div>
          <div className="stat-val">{activeLoansCount}</div>
          <div className="stat-sub">Portfolio: {fmtAmt(loanPortfolio._sum.principal ?? 0)}</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon" style={{ background: 'var(--bl)' }}>🌐</div>
          <div className="stat-lbl">Online Savings / Day</div>
          <div className="stat-val">₦{(onlineSavingDay._sum.amount ?? 0).toLocaleString()}</div>
          <div className="stat-trend trend-up">Today</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon" style={{ background: 'var(--gl)' }}>🌐</div>
          <div className="stat-lbl">Online Savings / Week</div>
          <div className="stat-val">₦{(onlineSavingWeek._sum.amount ?? 0).toLocaleString()}</div>
          <div className="stat-trend trend-up">This week</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon" style={{ background: 'var(--gdl)' }}>💵</div>
          <div className="stat-lbl">Cash Collection / Day</div>
          <div className="stat-val">₦{(cashSavingDay._sum.amount ?? 0).toLocaleString()}</div>
          <div className="stat-trend trend-up">Today</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-icon" style={{ background: 'var(--pul)' }}>💵</div>
          <div className="stat-lbl">Cash Collection / Week</div>
          <div className="stat-val">₦{(cashSavingWeek._sum.amount ?? 0).toLocaleString()}</div>
          <div className="stat-trend trend-up">This week</div>
        </div>
      </div>

      <div className="grid g-3-2">
        <div>
          <div className="sec-label" style={{ marginTop: 0 }}>Quick Actions</div>
          <div className="grid g3" style={{ marginBottom: 0 }}>
            <Link href="/dashboard/enrol" className="quick-btn">
              <div className="qb-ic" style={{ background: 'var(--gl)' }}>📋</div>
              <div><div className="qb-title">Enrol</div><div className="qb-desc">Register customer</div></div>
            </Link>
            <Link href="/dashboard/savings" className="quick-btn">
              <div className="qb-ic" style={{ background: 'var(--gdl)' }}>💰</div>
              <div><div className="qb-title">Save</div><div className="qb-desc">Credit savings</div></div>
            </Link>
            <Link href="/dashboard/redeem" className="quick-btn">
              <div className="qb-ic" style={{ background: 'var(--bl)' }}>🎯</div>
              <div><div className="qb-title">Redeem</div><div className="qb-desc">Pay out savings</div></div>
            </Link>
            <Link href="/dashboard/loan-request" className="quick-btn">
              <div className="qb-ic" style={{ background: 'var(--pul)' }}>🏦</div>
              <div><div className="qb-title">Loan Request</div><div className="qb-desc">New application</div></div>
            </Link>
            <Link href="/dashboard/loan-disburse" className="quick-btn">
              <div className="qb-ic" style={{ background: '#e8f0ff' }}>💸</div>
              <div><div className="qb-title">Disburse</div><div className="qb-desc">Release funds</div></div>
            </Link>
            <Link href="/dashboard/loan-repay" className="quick-btn">
              <div className="qb-ic" style={{ background: 'var(--gl)' }}>🔄</div>
              <div><div className="qb-title">Repayment</div><div className="qb-desc">Record payment</div></div>
            </Link>
          </div>

          <div className="sec-label">Recent Transactions</div>
          <div className="card card-sm">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th><th>Type</th><th>Amount</th><th>Time</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentTxns.map((t, i) => (
                    <tr key={t.id}>
                      <td>
                        {t.customer ? (
                          <>
                            <div className="td-name">{t.customer.firstName} {t.customer.lastName}</div>
                            <div className="td-sub">{t.customer.customerId}</div>
                          </>
                        ) : (
                          <div className="td-name">—</div>
                        )}
                      </td>
                      <td>{txnIcon(t.type)} {txnLabel(t.type)}</td>
                      <td className="td-mono" style={{
                        color: t.type === 'saving' ? 'var(--g)' : t.type === 'redemption' ? 'var(--rd)' : 'var(--b)'
                      }}>
                        {t.type === 'enrolment' ? 'New' : `${t.type === 'saving' ? '+' : t.type === 'redemption' ? '−' : ''}₦${t.amount.toLocaleString()}`}
                      </td>
                      <td style={{ color: 'var(--mu)' }}>
                        {new Date(t.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`bdg ${t.type === 'enrolment' ? 'bdg-gd' : 'bdg-ok'}`}>
                          {t.type === 'enrolment' ? 'New' : t.status}
                        </span>
                      </td>
                      <td>
                        <Link href={`/dashboard/transactions/${t.id}`} className="btn btn-out btn-sm" style={{ whiteSpace: 'nowrap' }}>→</Link>
                      </td>
                    </tr>
                  ))}
                  {recentTxns.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--mu)', padding: 16 }}>No transactions yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="sec-label" style={{ marginTop: 0 }}>Monthly Performance</div>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Collections — {now.toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
            <div className="bar-chart">
              {weeklyCollections.map((w, i) => (
                <div key={w.label} className="bar-col">
                  <div
                    className={`bar${i === weeklyCollections.length - 1 ? ' active' : ''}`}
                    style={{ height: `${Math.max(4, Math.round((w.total / maxWeekly) * 100))}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="bar-labels">
              {weeklyCollections.map((w, i) => (
                <span key={w.label} className="bar-lbl" style={i === weeklyCollections.length - 1 ? { color: 'var(--g)', fontWeight: 700 } : {}}>
                  {w.label}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 11.5, color: 'var(--mu)', marginTop: 2 }}>
              {weeklyCollections.map((w, i) => (
                <span key={w.label} style={{ flex: 1, textAlign: 'center', ...(i === weeklyCollections.length - 1 ? { color: 'var(--g)', fontWeight: 700 } : {}) }}>
                  {fmtAmt(w.total)}
                </span>
              ))}
            </div>
          </div>

          <div className="sec-label">
            Maturing Soon
            {maturingTotal > 0 && (
              <span style={{ float: 'right', fontSize: 11.5, color: 'var(--mu)', fontWeight: 400 }}>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, maturingTotal)} of {maturingTotal}
              </span>
            )}
          </div>
          <div className="card card-sm">
            {maturingSoon.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 16, fontSize: 13 }}>
                No plans maturing in the next 7 days
              </div>
            )}
            {maturingSoon.map((p, i) => {
              const days = daysDiff(new Date(p.maturityDate))
              const name = `${p.customer.firstName} ${p.customer.lastName}`
              const ini = initials(name)
              const avColor = avColors[i % avColors.length]
              return (
                <div key={p.id} className="cust-row" style={{ padding: '9px 0', borderBottom: i < maturingSoon.length - 1 ? undefined : 'none' }}>
                  <div className={`av ${avColor}`}>{ini}</div>
                  <div>
                    <div className="cust-name">{name}</div>
                    <div className="cust-sub">{new Date(p.maturityDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} · ₦{p.balance.toLocaleString()}</div>
                  </div>
                  <span className={`bdg ${days <= 1 ? 'bdg-rd' : 'bdg-gd'}`} style={{ marginLeft: 'auto' }}>
                    {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
                  </span>
                </div>
              )
            })}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--br)', marginTop: 4 }}>
                <Link
                  href={`/dashboard?mpage=${page - 1}`}
                  style={{
                    fontSize: 12.5, color: page > 1 ? 'var(--g)' : 'var(--mu)',
                    pointerEvents: page > 1 ? undefined : 'none',
                    textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  ← Prev
                </Link>
                <span style={{ fontSize: 12, color: 'var(--mu)' }}>Page {page} of {totalPages}</span>
                <Link
                  href={`/dashboard?mpage=${page + 1}`}
                  style={{
                    fontSize: 12.5, color: page < totalPages ? 'var(--g)' : 'var(--mu)',
                    pointerEvents: page < totalPages ? undefined : 'none',
                    textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  Next →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
