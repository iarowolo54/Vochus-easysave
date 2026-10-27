import { Icons } from '@/components/ui/icons'
import { formatNaira, formatTime } from '@/lib/format'

type Deposit = { amount: number; createdAt: string; method: string | null; recordedBy: string }

type Props = {
  weekly: boolean
  /** Deposits for the current day (or week, for weekly plans), newest first. */
  deposits: Deposit[]
}

/** Answers "did my money get recorded?" — the first thing a cash saver wants to know. */
export default function TodayStatus({ weekly, deposits }: Props) {
  const period = weekly ? 'this week' : 'today'
  if (deposits.length === 0) {
    return (
      <p className="ui-today">
        <Icons.pending size={16} aria-hidden="true" /> Nothing saved yet {period}
      </p>
    )
  }
  const total = deposits.reduce((sum, d) => sum + d.amount, 0)
  const latest = deposits[0]
  const time = formatTime(latest.createdAt)
  return (
    <p className="ui-today ui-today--done">
      <Icons.check size={16} aria-hidden="true" />
      {formatNaira(total, { minor: false })} saved {period} · {time} · {latest.recordedBy}
    </p>
  )
}
