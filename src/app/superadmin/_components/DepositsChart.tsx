'use client'

import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesPoint } from '@/lib/deposit-periods'

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`
const short = (n: number) => (n >= 1_000_000 ? `₦${+(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `₦${+(n / 1000).toFixed(1)}k` : `₦${n}`)

/** Running total of deposits through the month, this month against last. The lines draw in once, left to right. */
export default function DepositsChart({ data }: { data: SeriesPoint[] }) {
  const [animate, setAnimate] = useState(false)
  useEffect(() => { setAnimate(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) }, [])
  return (
    <div className="dep-chart" role="img" aria-label="Running total of savings deposits this month compared with last month">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e4e7e2" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#8b948f' }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 12, fill: '#8b948f' }} tickFormatter={short} />
          <Tooltip
            formatter={(v, name) => [naira(Number(v)), name === 'thisMonth' ? 'This month' : 'Last month']}
            labelFormatter={d => `Day ${d}`}
            contentStyle={{ borderRadius: 10, border: '1px solid #e4e7e2', fontSize: 13 }}
          />
          <Line type="monotone" dataKey="lastMonth" stroke="#b9c1bb" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={animate} animationDuration={700} animationEasing="ease-out" />
          <Line type="monotone" dataKey="thisMonth" stroke="#17783a" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={animate} animationBegin={150} animationDuration={900} animationEasing="ease-out" />
        </LineChart>
      </ResponsiveContainer>
      <div className="dep-legend" aria-hidden="true">
        <span><i style={{ background: '#17783a' }} />This month</span>
        <span><i style={{ background: '#b9c1bb' }} />Last month</span>
      </div>
    </div>
  )
}
