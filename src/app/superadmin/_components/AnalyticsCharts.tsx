'use client'

import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Bucket } from '@/lib/analytics'

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`
const short = (n: number) => (n >= 1_000_000 ? `₦${+(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `₦${+(n / 1000).toFixed(1)}k` : `₦${n}`)
const label = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function useMotion() {
  const [on, setOn] = useState(false)
  useEffect(() => { setOn(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) }, [])
  return on
}
const axis = { fontSize: 12, fill: '#8b948f' }
const tip = { borderRadius: 10, border: '1px solid #e4e7e2', fontSize: 13 }

export function DepositsBars({ data, weekly }: { data: Bucket[]; weekly: boolean }) {
  const motion = useMotion()
  return (
    <div className="dep-chart" role="img" aria-label={`Savings deposited per ${weekly ? 'week' : 'day'}`}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e4e7e2" vertical={false} />
          <XAxis dataKey="start" tickFormatter={label} tickLine={false} axisLine={false} tick={axis} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={axis} tickFormatter={short} />
          <Tooltip cursor={{ fill: '#f1f3f0' }} formatter={v => [naira(Number(v)), 'Deposited']} labelFormatter={d => (weekly ? `Week of ${label(String(d))}` : label(String(d)))} contentStyle={tip} />
          <Bar dataKey="deposits" fill="#17783a" radius={[4, 4, 0, 0]} isAnimationActive={motion} animationDuration={800} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function GrowthBars({ data, weekly }: { data: Bucket[]; weekly: boolean }) {
  const motion = useMotion()
  return (
    <div className="dep-chart" role="img" aria-label={`New customers and new agents per ${weekly ? 'week' : 'day'}`}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e4e7e2" vertical={false} />
          <XAxis dataKey="start" tickFormatter={label} tickLine={false} axisLine={false} tick={axis} interval="preserveStartEnd" minTickGap={28} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={axis} />
          <Tooltip cursor={{ fill: '#f1f3f0' }} labelFormatter={d => (weekly ? `Week of ${label(String(d))}` : label(String(d)))} contentStyle={tip} />
          <Bar dataKey="customers" name="New customers" fill="#17783a" radius={[4, 4, 0, 0]} isAnimationActive={motion} animationDuration={800} />
          <Bar dataKey="agents" name="New agents" fill="#9fb8a6" radius={[4, 4, 0, 0]} isAnimationActive={motion} animationBegin={120} animationDuration={800} />
        </BarChart>
      </ResponsiveContainer>
      <div className="dep-legend" aria-hidden="true">
        <span><i style={{ background: '#17783a' }} />New customers</span>
        <span><i style={{ background: '#9fb8a6' }} />New agents</span>
      </div>
    </div>
  )
}
